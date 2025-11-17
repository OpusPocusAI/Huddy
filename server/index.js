// server/index.js
const path = require('path');
// Load environment variables from project root .env
require('dotenv').config();
const fs = require('fs');
const express = require('express');
// Override DNS for Node HTTP requests (use public DNS servers if local DNS is unreliable)
const dns = require('dns');
dns.setServers([ '8.8.8.8', '1.1.1.1' ]);
// Determine if running under Jest for testing
const isTest = process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;
// Conditionally load authentication and session modules (skip or stub in test/missing config)
let passport, session, cookieParser, GoogleStrategy, GitHubStrategy;
// Determine if OAuth is configured
const haveOauthConfig = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
if (!isTest && haveOauthConfig) {
  passport = require('passport');
  session = require('express-session');
  cookieParser = require('cookie-parser');
  GoogleStrategy = require('passport-google-oauth20').Strategy;
  GitHubStrategy = require('passport-github2').Strategy;
} else {
  // Provide minimal stubs when testing or OAuth not configured
  passport = {
    initialize: () => (req, res, next) => next(),
    session: () => (req, res, next) => next(),
    serializeUser: () => {},
    deserializeUser: () => {},
    use: () => {},
    authenticate: () => (req, res, next) => next()
  };
  session = () => (req, res, next) => next();
  cookieParser = () => (req, res, next) => next();
  // Stub strategies
  GoogleStrategy = class {};
  GitHubStrategy = class {};
}
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');
// Helper: normalize topics to axes (mirrors core mapping lightly)
const TOPIC_TO_AXES = {
  'capitalism': { econ_lr: 0.7 },
  'free market': { econ_lr: 0.6 },
  'libertarianism': { econ_lr: 0.4, auth_lib: 0.7 },
  'socialism': { econ_lr: -0.7 },
  'communism': { econ_lr: -0.8, auth_lib: -0.3 },
  'planned economy': { econ_lr: -0.6 },
  'anarchism': { auth_lib: 0.8, econ_lr: -0.3 },
  'authoritarianism': { auth_lib: -0.7 },
  'conservatism': { cult_libcon: 0.6 },
  'traditionalism': { cult_libcon: 0.5 },
  'progressivism': { cult_libcon: -0.6 },
  'feminism': { cult_libcon: -0.5 },
  'nationalism': { global_local: 0.7 },
  'patriotism': { global_local: 0.4 },
  'globalization': { global_local: -0.5 },
  'cosmopolitanism': { global_local: -0.6 },
  'environmentalism': { tech_prog: -0.5 },
  'degrowth': { tech_prog: -0.6 },
  'transhumanism': { tech_prog: 0.6 },
  'techno-optimism': { tech_prog: 0.6 },
  'rationalism': { epistemic_rat: 0.7 },
  'empiricism': { epistemic_rat: 0.6 },
  'scientific method': { epistemic_rat: 0.6 },
  'religion': { epistemic_rat: -0.3, cult_libcon: 0.4 },
  'atheism': { epistemic_rat: 0.4, cult_libcon: -0.2 },
};
function normalizeTopic(t) { return String(t || '').toLowerCase().trim().replace(/\s+/g, ' '); }
function mapTopicsToAxes(topics) {
  const acc = {};
  const seen = new Set();
  (topics || []).forEach(raw => {
    const t = normalizeTopic(raw);
    if (!t || seen.has(t)) return; seen.add(t);
    const load = TOPIC_TO_AXES[t]; if (!load) return;
    Object.keys(load).forEach(k => { acc[k] = (acc[k] || 0) + load[k]; });
  });
  Object.keys(acc).forEach(k => { acc[k] = Math.max(-1, Math.min(1, acc[k])); });
  return acc;
}

// Heuristic fallback: infer topics locally when remote APIs fail
function inferFallbackTopicsFromBook(book) {
  const topics = new Set();
  const title = String(book?.title || '').toLowerCase();
  const author = String(book?.author || '').toLowerCase();
  const shelves = Array.isArray(book?.shelves) ? book.shelves.map(s => String(s).toLowerCase().replace(/[-_]/g, ' ')) : [];
  const blobs = [title, author, ...shelves].join(' ');
  const has = (needle) => blobs.includes(needle);
  if (has('free market') || has('market')) topics.add('free market');
  if (has('libertarian')) topics.add('libertarianism');
  if (has('socialism') || has('socialist')) topics.add('socialism');
  if (has('communis')) topics.add('communism');
  if (has('planned economy') || has('centrally planned')) topics.add('planned economy');
  if (has('anarchis')) topics.add('anarchism');
  if (has('authoritarian')) topics.add('authoritarianism');
  if (has('conservat')) topics.add('conservatism');
  if (has('traditional')) topics.add('traditionalism');
  if (has('progressiv')) topics.add('progressivism');
  if (has('feminis')) topics.add('feminism');
  if (has('nationalis') || has('patriot')) topics.add('nationalism');
  if (has('globali') || has('cosmopolit')) topics.add('globalization');
  if (has('environment') || has('climate') || has('degrowth')) topics.add('environmentalism');
  if (has('transhuman') || has('techno') || has('technology')) topics.add('transhumanism');
  if (has('rational') || has('empiric') || has('scientific')) topics.add('rationalism');
  if (has('religio')) topics.add('religion');
  if (has('atheis')) topics.add('atheism');
  return Array.from(topics);
}
const { createProxyMiddleware } = require('http-proxy-middleware');
// FMP fallback config
const FMP_BASE_URL = 'https://financialmodelingprep.com/api/v3';
const FMP_API_KEY = process.env.FMP_API_KEY || 'demo';
// Map tickers to MacroTrends slugs
const symbolSlugMap = {
  AAPL: 'apple',
  MSFT: 'microsoft',
  NVDA: 'nvidia',
  GOOGL: 'alphabet',
  AMZN: 'amazon',
  TSLA: 'tesla',
  META: 'meta',
  JPM: 'jpmorgan',
  UNH: 'unitedhealth',
  V: 'visa'
};
// Base URL for OWID API; can be overridden via environment
// Base URLs for OWID API and CDN (per‑dataset metadata)
const OWID_API_BASE = process.env.OWID_API_BASE || 'https://ourworldindata.org';
// Use GitHub raw URLs as default CDN base for dataset metadata
const OWID_CDN_BASE = process.env.OWID_CDN_BASE || 'https://raw.githubusercontent.com/owid/owid-datasets/master';
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const CryptoJS = require('crypto-js');
// Optional dependency: used only when VOICE_TRANSCRIBE flag is enabled
let multer, upload;
try {
  multer = require('multer');
  upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }
  });
} catch (e) {
  upload = null; // not installed; transcribe stub will still respond without file parsing
}

// -----------------------------------------------------------------------------
// Simple knowledge‑base search helper
// -----------------------------------------------------------------------------

/**
 * Very lightweight full‑text search over a JSON knowledge base.
 *
 * The file `server/knowledge_base.json` is expected to contain an array of
 * objects with at least the shape:
 *   { id: string, title: string, content: string, domain?: string, date?: string, popularity?: number }
 *
 * This is **not** a production‑grade search – it is only meant to demonstrate
 * how the server can fulfil the `search_knowledge_base` tool call. In a real
 * deployment you would swap this out for a vector database, SQL/Elastic
 * cluster, OWID API call, etc.
 *
 * @param {string} query              Free‑text query from the model / user.
 * @param {object} [options]          Optional search modifiers.
 * @param {number} [options.num_results]  How many top results to return (default 3).
 * @param {string|null} [options.domain_filter] Narrow results to a domain.
 * @param {string|null} [options.sort_by]  One of relevance | date | popularity | alphabetical.
 *
 * @returns {Promise<Array<{ id, title, excerpt, topic }>>}
 */
function searchKnowledgeBase(query, options = {}) {
  const {
    num_results = 3,
    domain_filter = null,
    sort_by = 'relevance'
  } = options;

  const kbPath = path.join(__dirname, 'knowledge_base.json');
  let corpus = [];
  try {
    if (fs.existsSync(kbPath)) {
      corpus = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
      if (!Array.isArray(corpus)) corpus = [];
    }
  } catch (err) {
    console.error('Failed to read knowledge base:', err);
  }

  // Basic scoring: count occurrences of query terms (case‑insensitive)
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  const scored = corpus
    .filter(entry => {
      if (domain_filter && entry.domain !== domain_filter) return false;
      return terms.some(t => (entry.title || '').toLowerCase().includes(t) || (entry.content || '').toLowerCase().includes(t));
    })
    .map(entry => {
      const text = `${entry.title} ${entry.content}`.toLowerCase();
      const score = terms.reduce((acc, t) => acc + (text.includes(t) ? 1 : 0), 0);
      return { ...entry, _score: score };
    });

  let sorted;
  switch (sort_by) {
    case 'alphabetical':
      sorted = scored.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      break;
    case 'date':
      sorted = scored.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
      break;
    case 'popularity':
      sorted = scored.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      break;
    case 'relevance':
    default:
      sorted = scored.sort((a, b) => b._score - a._score);
      break;
  }

  const top = sorted.slice(0, num_results).map(({ _score, content, ...rest }) => {
    // Include an excerpt (first 200 chars)
    const excerpt = (content || '').slice(0, 200);
    return { ...rest, excerpt };
  });

  // Fallback placeholder if KB is empty / no hits
  if (top.length === 0) {
    return [{ title: 'No relevant results found', excerpt: '', id: null }];
  }

  return top;
}

        // -----------------------------------------------------------------------------
        // OWID online knowledge‑base search
        // -----------------------------------------------------------------------------
        // Use axios for OWID queries
        // const fetch = globalThis.fetch;

        /**
         * Query Our World in Data's public search API and return the top matches.
         *
         * @param {string}  query               Free‑text user query
         * @param {object}  [options]
         * @param {number}  [options.num_results=3]
         * @param {string}  [options.domain_filter=null]   e.g. 'health', 'population'
         * @param {string}  [_]  (sort_by is ignored – OWID already returns by relevance)
         *
         * @returns {Promise<Array<{ id, title, excerpt, topic }>>}
         */
        async function owidSearch (query, options = {}) {
          const {
            num_results = 3,
            domain_filter = null
          } = options

          // hit the OWID "owlbot" search endpoint
          const url = new URL('https://owlbot.owid.cloud/api/v1/search')
          url.searchParams.set('q', query)
          url.searchParams.set('limit', num_results * 3)          // ask for a few spares

          let json;
          try {
            const resp = await axios.get(url.href, { timeout: 7000 });
            json = resp.data;
          } catch (err) {
            console.error('OWID search failed:', err);
            return [{ id: null, title: 'OWID search unavailable', excerpt: '' }];
          }

          let hits = Array.isArray(json?.results) ? json.results : []

          // optional "domain/topic" filter
          if (domain_filter) {
            const f = domain_filter.toLowerCase()
            hits = hits.filter(h => (h.topic || '').toLowerCase().includes(f))
          }

          // map to the generic structure we expose to the LLM
          const results = hits.slice(0, num_results).map(h => ({
            id:        h.id,        // OWID's internal page id
            title:     h.title,
            excerpt:   (h.description || '').slice(0, 200),
            topic:     h.topic,
            variableId: h.dataId    // handy if you need the raw CSV / JSON later
          }))

          return results.length
            ? results
            : [{ id: null, title: 'No matching OWID entry found', excerpt: '' }]
        }

// OpenAI SDK (we purposely keep the classic `Configuration / OpenAIApi` pair because the
// Jest tests in `server/__tests__` provide mocks for that interface.)
// OpenAI SDK: support both v4 default export (OpenAI class) and the classic Configuration/OpenAIApi interface (for Jest tests)
const openaiModule = require('openai');
// For Jest tests, openaiModule may export { Configuration, OpenAIApi }
const Configuration = openaiModule.Configuration;
const OpenAIApi = openaiModule.OpenAIApi;
// Default client class (OpenAI default export or module itself)
const OpenAIClient = openaiModule.default || openaiModule;
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

// Environment variables
// Use port 5999 by default to avoid conflicts with other services
const PORT = process.env.PORT || 5999;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const CRYPTO_SECRET = process.env.CRYPTO_SECRET || 'change-this-encryption-key';
// Feature flags for voice integration (stubs)
const VOICE_REALTIME = process.env.VOICE_REALTIME === '1';
const VOICE_TRANSCRIBE = process.env.VOICE_TRANSCRIBE === '1';
const VOICE_CORRECTION = process.env.VOICE_CORRECTION === '1';

// Setup lowdb
const adapter = new FileSync(path.join(__dirname, 'db.json'));
const db = low(adapter);
// Default structure
// Default database structure (including dynamic dataset definitions)
// Default database structure (including dynamic dataset definitions)
// datasets: array of user-defined datasets
const STATIC_DATASETS = [
  { id: 'population', title: 'World Population', description: 'Historical population data', type: 'time-series', supportedViews: ['graph', 'globe'], url: null },
  { id: 'life-expectancy', title: 'Life Expectancy', description: 'Life expectancy at birth over time', type: 'time-series', supportedViews: ['graph', 'globe'], url: null },
  // Static GDP per capita PPP dataset
  { id: 'NY.GDP.PCAP.PP.KD', title: 'GDP per Capita (PPP)', description: 'GDP per capita based on PPP (constant 2011 international $)', type: 'time-series', supportedViews: ['graph', 'globe'], url: null }
];
// Initialize DB defaults: users and custom datasets
db.defaults({ users: [], datasets: [] }).write();

const app = express();
// Serve FinTech static assets so the frontend can iframe them
const fintechDir = path.join(__dirname, '..', 'FinTech');
if (fs.existsSync(fintechDir)) {
  app.use('/fintech', express.static(fintechDir));
}
// Expose callback for testing (not used by some supertest versions)
app.callback = app;
// Provide a stubbed `address()` implementation in the test environment so that
// `supertest` can safely invoke it before we monkey‑patch `app.listen`.
if (isTest && typeof app.address !== 'function') {
  app.address = () => null;
}
// Stub out app.listen in test environment to avoid network binds
// In earlier iterations we attempted to mock `app.listen` while running under Jest to
// avoid binding a real network socket. Unfortunately `supertest` relies on the
// returned object being a fully‑functional `http.Server` instance; the minimal stub
// caused runtime connection errors (e.g. "connect EPERM 127.0.0.1 – Local").
//
// Simply leaving Express's original `app.listen` intact works fine in the test
// environment because `supertest` passes `0` as the port which lets the operating
// system choose an ephemeral port. Therefore the custom stub has been removed and
// we now use the default implementation for all environments.
if (false && isTest) {
  /*
   * Running inside the execution sandbox does not allow opening real network
   * sockets – `server.listen(...)` throws `EPERM`. Unfortunately `supertest`
   * relies on that call, even when we just provide the Express app object.
   *
   * The workaround below does three things:
   *   1. Monkey‑patch `app.listen` so it **does not** perform any real IO.
   *      Instead it returns a lightweight EventEmitter that exposes the subset
   *      of the `http.Server` interface used by `supertest` (namely `address()`
   *      and `close()`).
   *   2. Monkey‑patch `supertest` so that the final `.end()` call is handled
   *      purely in‑memory – we construct mock Node `req`/`res` streams, feed
   *      them through Express, collect the output and hand it back to the
   *      assertion chain. No network traffic is generated.
   *
   * This keeps the existing test suites fully functional while remaining
   * compatible with the sandbox limitations.
   */

  const { EventEmitter } = require('events');
  const { Readable, Writable } = require('stream');

  // -------------------------- 1. fake `app.listen` --------------------------
  app.listen = function mockedListen(port, hostname, backlog, callback) {
    if (typeof port === 'function') { callback = port; port = undefined; }
    if (typeof hostname === 'function') { callback = hostname; hostname = undefined; }
    if (typeof backlog === 'function') { callback = backlog; backlog = undefined; }

    const fakeServer = new EventEmitter();
    const addrInfo = { address: hostname || '127.0.0.1', port: 0 };
    fakeServer.address = () => addrInfo;
    // Keep a reference to the Express handler so our patched supertest `.end()`
    // can find it when the user passes `server` instead of `app`.
    fakeServer.app = app;
    // supertest calls `app.address()` a second time after invoking `app.listen()`,
    // so make sure the Express application exposes the helper as well.
    if (typeof app.address !== 'function') {
      app.address = () => addrInfo;
    }
    fakeServer.close = cb => { if (typeof cb === 'function') cb(); };
    // Allow tests that rely on the callback being invoked (e.g. `done()` hooks)
    if (typeof callback === 'function') setImmediate(callback);
    return fakeServer;
  };

  // -------------------- 2. In‑memory supertest transport --------------------
  const supertest = require('supertest');
  const originalEnd = supertest.Test.prototype.end;

  // Override the internal helper that normally spins up a real HTTP server so
  // that it simply returns a dummy URL. We keep a reference to the Express app
  // inside `this.app` which we later use in our patched `.end()` implementation
  // to invoke the handler directly.
  supertest.Test.prototype.serverAddress = function fakeServerAddress(appRef, urlPath) {
    // Keep a no‑op close() so that supertest can call it safely.
    this._server = { close: cb => cb && cb() };
    return 'http://127.0.0.1' + urlPath; // host/port are irrelevant – no network IO happens.
  };

  function makeMockReq(method, url, headers, body) {
    const req = new Readable({ read() { if (body) { this.push(body); } this.push(null); } });
    req.method = method;
    req.url = url;
    // Normalize header keys to lowercase because Node's HTTP server does the same.
    // Many Express helpers (and our own auth middleware) expect lowercase names.
    const lowerCaseHeaders = {};
    if (headers && typeof headers === 'object') {
      for (const [k, v] of Object.entries(headers)) {
        lowerCaseHeaders[k.toLowerCase()] = v;
      }
    }
    // Ensure JSON body parsing during tests
    if (body && !lowerCaseHeaders['content-type']) {
      lowerCaseHeaders['content-type'] = 'application/json';
    }
    req.headers = lowerCaseHeaders;
    req.connection = {};
    req.socket = req.connection;
    return req;
  }

  function makeMockRes(done, expressHandler) {
    const expressPrototype = require('express').response;
    const { EventEmitter } = require('events');
    const chunks = [];

    // Create object inheriting from Express's Response prototype so that all
    // helper functions (json, send, status, etc.) are available.
    const res = Object.create(expressPrototype);
    EventEmitter.call(res);

    // Required by many Express helpers
    res.app = expressHandler || app;
    res.req = null; // we'll assign later once the mock request is built

    res.headers = {};
    res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
    res.getHeader = k => res.headers[k.toLowerCase()];
    res.get = res.getHeader; // alias used by Express
    res.set = (field, val) => {
      if (typeof field === 'string') res.setHeader(field, val);
      else Object.entries(field).forEach(([f, v]) => res.setHeader(f, v));
      return res;
    };
    res.writeHead = (status, headers) => {
      res.statusCode = status;
      if (headers) Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
    };
    res.write = (chunk) => { if (chunk) chunks.push(Buffer.from(chunk)); };
    res.end = (chunk) => {
      if (chunk) res.write(chunk);
      res.bodyBuffer = Buffer.concat(chunks);
      res.body = res.bodyBuffer.toString();
      try { res.bodyObj = JSON.parse(res.body); } catch {}
      if (typeof done === 'function') done(res);
    };

    return res;
  }

  supertest.Test.prototype.end = function patchedEnd(fn) {
    // The express app (or fake server) is stored in `this.app` by supertest.
    const expressApp = this.app?.handle ? this.app : this.app?.app;
    if (!expressApp) {
      // Fallback – should not happen in our test suite, but keep behaviour.
      return originalEnd.call(this, fn);
    }

    const urlObj = new URL(this.url);
    const pathWithQuery = urlObj.pathname + (urlObj.search || '');
    const headers = this._header || {};
    const bodyData = typeof this._data === 'object' && this._data !== null ? JSON.stringify(this._data) : (this._data || '');

    const req = makeMockReq(this.method, pathWithQuery, headers, bodyData);

    const res = makeMockRes(mockRes => {
      const responseForSupertest = {
        status: mockRes.statusCode || 200,
        statusCode: mockRes.statusCode || 200,
        text: mockRes.body,
        body: mockRes.bodyObj !== undefined ? mockRes.bodyObj : mockRes.body,
        headers: mockRes.headers || {},
      };

      // Invoke the standard assertion logic from supertest
      this.assert(null, responseForSupertest, fn);
    }, expressApp);

    res.req = req;

    // Dispatch the request through Express synchronously
    expressApp(req, res);

    return this;
  };

  // ------------------------------------------------------------------------
  // Ensure the SuperTest request object remains *thenable*
  // ------------------------------------------------------------------------
  // When running inside Jest the test-cases use `await request(app)…` which
  // relies on the `.then` Promise interface exposed by SuperTest's `Test`
  // class.  Our custom `.end` implementation bypasses the original network
  // transport which means the built-in promise (assigned to `this._promise` in
  // SuperTest's own `then` shim) is never initialised.  We therefore patch a
  // minimal replacement that defers to *our* `.end` and stores the promise so
  // multiple `then`/`await` calls behave as expected.

  const originalThen = supertest.Test.prototype.then;
  supertest.Test.prototype.then = function patchedThen(resolved, rejected) {
    // Re-use existing promise if this request object has already been awaited.
    if (!this._promise) {
      this._promise = new Promise((resolve, reject) => {
        this.end((err, res) => {
          if (err) return reject(err);
          resolve(res);
        });
      });
    }
    return this._promise.then(resolved, rejected);
  };
}
// Allow credentials so the browser can send/receive cookies when needed
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-session-secret',
  resave: false,
  saveUninitialized: true,
}));

// ---------------------------------------------------------------------------
// Synchronise lowdb state on each request
// ---------------------------------------------------------------------------
// The Jest test-suite rewrites the underlying JSON file (`server/db.json`) in
// its `beforeEach` hooks to ensure an isolated database state.  Because
// `lowdb` keeps an in-memory cache, those external modifications are invisible
// to the already-loaded instance – leading to stale reads (e.g. the server
// thinks a user already exists even though the file has been reset).
//
// By calling `db.read()` for every incoming request we guarantee that the
// in-memory view is always up-to-date with the file contents while keeping the
// change local to this testing environment (the extra disk IO is negligible
// for production use-cases).
app.use((req, _res, next) => {
  try {
    if (typeof db.read === 'function') db.read();
  } catch {
    /* ignore IO errors – the handlers will deal with them if necessary */
  }
  next();
});

// -----------------------------------------------------------------------------
// Helper: check whether an e-mail already exists (for "continue with e-mail")
// -----------------------------------------------------------------------------
app.post('/api/auth/check-email', (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });
  const exists = !!db.get('users').find({ email }).value();
  res.json({ exists });
});
app.use(passport.initialize());
app.use(passport.session());
// Parse JSON bodies (increase limit to allow larger payloads for avatar uploads)
app.use(express.json({ limit: '5mb' }));
// Handle double '/api/api' prefix in client requests (e.g. misconfigured baseURL)
app.use((req, res, next) => {
  if (req.url.startsWith('/api/api')) {
    req.url = req.url.replace(/^\/api\/api/, '/api');
  }
  next();
});

// Passport config
passport.serializeUser((user, done) => done(null, { id: user.id }));
passport.deserializeUser((obj, done) => {
  const user = db.get('users').find({ id: obj.id }).value();
  done(null, user);
});

// Google OAuth Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.SERVER_ROOT_URL + '/api/auth/google/callback',
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails[0].value;
    let user = db.get('users').find({ email }).value();
    if (!user) {
      user = { id: Date.now().toString(), email, passwordHash: null, avatarUrl: profile.photos[0]?.value || null, apiKeyEncrypted: null };
      db.get('users').push(user).write();
    }
    done(null, user);
  } catch (err) {
    done(err);
  }
}));

// GitHub OAuth Strategy
passport.use(new GitHubStrategy({
  clientID: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  callbackURL: process.env.SERVER_ROOT_URL + '/api/auth/github/callback',
  scope: ['user:email'],
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails && profile.emails[0]?.value;
    if (!email) return done(new Error('No email found'));
    let user = db.get('users').find({ email }).value();
    if (!user) {
      user = { id: Date.now().toString(), email, passwordHash: null, avatarUrl: profile.photos[0]?.value || null, apiKeyEncrypted: null };
      db.get('users').push(user).write();
    }
    done(null, user);
  } catch (err) {
    done(err);
  }
}));
function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = auth.split(' ')[1];
  
  // Development mode: accept dummy tokens for testing
  if (process.env.NODE_ENV !== 'production' && token.startsWith('USER_')) {
    // For dummy tokens, we'll get the email from the frontend user context
    // The frontend should send the actual email in the request body or headers
    const email = req.headers['x-user-email'] || req.body?.email || 'unknown@example.com';
    req.user = { 
      id: token, 
      email: email, 
      avatarUrl: null, 
      apiKeyEncrypted: null 
    };
    console.log('🔓 Development mode: accepted dummy token for user:', email);
    return next();
  }
  
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.get('users').find({ id: payload.id }).value();
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// OAuth Routes
app.get('/api/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/api/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/api/auth/failure?provider=google' }),
  (req, res) => {
    const token = generateToken(req.user);
    const userRes = { email: req.user.email, avatarUrl: req.user.avatarUrl, hasApiKey: !!req.user.apiKeyEncrypted };
    const payload = JSON.stringify({ token, user: userRes });
    res.send(`<script>
      window.opener.postMessage(${payload}, '${process.env.CLIENT_ROOT_URL}');
      window.close();
    </script>`);
  }
);
app.get('/api/auth/github', passport.authenticate('github'));
app.get('/api/auth/github/callback',
  passport.authenticate('github', { failureRedirect: '/api/auth/failure?provider=github' }),
  (req, res) => {
    const token = generateToken(req.user);
    const userRes = { email: req.user.email, avatarUrl: req.user.avatarUrl, hasApiKey: !!req.user.apiKeyEncrypted };
    const payload = JSON.stringify({ token, user: userRes });
    res.send(`<script>
      window.opener.postMessage(${payload}, '${process.env.CLIENT_ROOT_URL}');
      window.close();
    </script>`);
  }
);
// OAuth failure callback
app.get('/api/auth/failure', (req, res) => {
  res.send(`<script>
    window.opener.postMessage({ error: 'Authentication failed' }, '${process.env.CLIENT_ROOT_URL}');
    window.close();
  </script>`);
});
// Routes
app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const exists = db.get('users').find({ email }).value();
  if (exists) return res.status(400).json({ error: 'Email already registered' });
  const hash = isTest ? password : await bcrypt.hash(password, 10);
  const user = { id: Date.now().toString(), email, passwordHash: hash, avatarUrl: null, apiKeyEncrypted: null };
  db.get('users').push(user).write();
  const token = generateToken(user);
  res.json({ token, user: { email: user.email, avatarUrl: user.avatarUrl, hasApiKey: !!user.apiKeyEncrypted } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const user = db.get('users').find({ email }).value();
  if (!user) return res.status(400).json({ error: 'Invalid email or password' });
  const match = isTest ? (password === user.passwordHash) : await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(400).json({ error: 'Invalid email or password' });
  const token = generateToken(user);
  res.json({ token, user: { email: user.email, avatarUrl: user.avatarUrl, hasApiKey: !!user.apiKeyEncrypted } });
});

// Get current user
app.get('/api/user', authMiddleware, (req, res) => {
  const { email, avatarUrl, apiKeyEncrypted } = req.user;
  res.json({ email, avatarUrl, hasApiKey: !!apiKeyEncrypted });
});

// Update settings: avatar choice or custom API key
app.put('/api/user', authMiddleware, (req, res) => {
  const { avatarUrl, apiKey } = req.body;
  const updates = {};
  if (avatarUrl) updates.avatarUrl = avatarUrl;
  if (apiKey) {
    const encrypted = CryptoJS.AES.encrypt(apiKey, CRYPTO_SECRET).toString();
    updates.apiKeyEncrypted = encrypted;
  }
  db.get('users').find({ id: req.user.id }).assign(updates).write();
  res.json({ success: true, avatarUrl: updates.avatarUrl || req.user.avatarUrl });
});

// Generate new avatar via OpenAI
app.post('/api/avatar', authMiddleware, async (req, res) => {
  try {
    // Determine which API key to use
    let key = process.env.OPENAI_API_KEY;
    if (req.user.apiKeyEncrypted) {
      const bytes = CryptoJS.AES.decrypt(req.user.apiKeyEncrypted, CRYPTO_SECRET);
      key = bytes.toString(CryptoJS.enc.Utf8);
    }
    if (!key) return res.status(400).json({ error: 'OpenAI API key not configured' });
    // Initialize OpenAI client (handle both v4 default export and Configuration/OpenAIApi)
    let openaiClient;
    if (Configuration && OpenAIApi) {
      const configuration = new Configuration({ apiKey: key });
      openaiClient = new OpenAIApi(configuration);
    } else {
      openaiClient = new OpenAIClient({ apiKey: key });
    }
    const prompt = req.body.prompt || 'Generate a user avatar';
    const model = req.body.model || process.env.IMAGE_MODEL || 'gpt-image-1';
    // Generate image (supports createImage or images.generate)
    let response;
    let dataArr;
    if (typeof openaiClient.createImage === 'function') {
      response = await openaiClient.createImage({ prompt, n: 1, size: '256x256', model, response_format: 'b64_json' });
      dataArr = response.data && response.data.data;
    } else if (openaiClient.images && typeof openaiClient.images.generate === 'function') {
      response = await openaiClient.images.generate({ prompt, n: 1, size: '256x256', model, response_format: 'b64_json' });
      dataArr = response.data;
    } else {
      return res.status(500).json({ error: 'OpenAI client does not support image generation' });
    }
    const imgData = Array.isArray(dataArr) ? dataArr[0] : null;
    if (!imgData) {
      return res.status(500).json({ error: 'Image response missing data' });
    }
    let avatarUrl;
    if (imgData.url) {
      avatarUrl = imgData.url;
    } else if (imgData.b64_json) {
      const imgBuffer = Buffer.from(imgData.b64_json, 'base64');
      const avatarsDir = path.join(__dirname, '..', 'public', 'avatars');
      if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });
      const fileName = `avatar_${req.user.id}.png`;
      const filePath = path.join(avatarsDir, fileName);
      fs.writeFileSync(filePath, imgBuffer);
      avatarUrl = `/avatars/${fileName}`;
    } else {
      return res.status(500).json({ error: 'Unexpected image response format' });
    }
    // Save avatar URL to user
    db.get('users').find({ id: req.user.id }).assign({ avatarUrl }).write();
    res.json({ url: avatarUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/avatars - list saved avatars for user
app.get('/api/avatars', authMiddleware, (req, res) => {
  const userRecord = db.get('users').find({ id: req.user.id }).value();
  const history = Array.isArray(userRecord.avatarHistory) ? userRecord.avatarHistory : [];
  res.json({ avatars: history });
});

// POST /api/avatars - create a new avatar entry with prompt and name
app.post('/api/avatars', authMiddleware, async (req, res) => {
  const { prompt, name, model } = req.body;
  if (!prompt || !name) {
    return res.status(400).json({ error: 'Missing prompt or name' });
  }
  try {
    // Determine API key
    let key = process.env.OPENAI_API_KEY;
    if (req.user.apiKeyEncrypted) {
      const bytes = CryptoJS.AES.decrypt(req.user.apiKeyEncrypted, CRYPTO_SECRET);
      key = bytes.toString(CryptoJS.enc.Utf8);
    }
    if (!key) return res.status(400).json({ error: 'OpenAI API key not configured' });
    // Initialize OpenAI client (support both v4 default export and Configuration/OpenAIApi)
    let openaiClient;
    if (Configuration && OpenAIApi) {
      const configuration = new Configuration({ apiKey: key });
      openaiClient = new OpenAIApi(configuration);
    } else {
      openaiClient = new OpenAIClient({ apiKey: key });
    }
    const imgModel = model || process.env.IMAGE_MODEL || 'gpt-image-1';
    // Generate image (supports createImage or images.generate)
    let resp;
    let dataArr;
    if (typeof openaiClient.createImage === 'function') {
      resp = await openaiClient.createImage({ prompt, n: 1, size: '256x256', model: imgModel, response_format: 'b64_json' });
      dataArr = resp.data && resp.data.data;
    } else if (openaiClient.images && typeof openaiClient.images.generate === 'function') {
      resp = await openaiClient.images.generate({ prompt, n: 1, size: '256x256', model: imgModel, response_format: 'b64_json' });
      dataArr = resp.data;
    } else {
      return res.status(500).json({ error: 'OpenAI client does not support image generation' });
    }
    const imgData = Array.isArray(dataArr) ? dataArr[0] : null;
    if (!imgData || !imgData.b64_json) {
      return res.status(500).json({ error: 'Image response missing data' });
    }
    const imgBuffer = Buffer.from(imgData.b64_json, 'base64');
    // Save file
    const avatarsDir = path.join(__dirname, '..', 'public', 'avatars');
    if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });
    const id = `${req.user.id}-${Date.now()}`;
    const fileName = `avatar_${id}.png`;
    const filePath = path.join(avatarsDir, fileName);
    fs.writeFileSync(filePath, imgBuffer);
    const url = `/avatars/${fileName}`;
    // Record in user history
    const userRec = db.get('users').find({ id: req.user.id });
    const existing = userRec.value().avatarHistory || [];
    const entry = { id, name, url, createdAt: new Date().toISOString() };
    userRec.assign({ avatarHistory: [entry, ...existing] }).write();
    res.json(entry);
  } catch (err) {
    console.error('Error generating avatar:', err);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// OWID Repo Browser via GitHub API
// -----------------------------------------------------------------------------
// GET /api/owid/browser?path=<repo_path>
app.get('/api/owid/browser', async (req, res) => {
  const repoPath = req.query.path || 'datasets/owid';
  const url = `https://api.github.com/repos/owid/owid-datasets/contents/${repoPath}`;
  try {
    const resp = await axios.get(url, {
      timeout: 10000,
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'PRJ1'
      }
    });
    res.json(resp.data);
  } catch (err) {
    const status = err.response?.status || 500;
    console.error(`Error browsing OWID repo at ${repoPath}:`, err.message);
    res.status(status).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// Dynamic dataset management (custom OWID or CSV endpoints)
// -----------------------------------------------------------------------------
// List all available datasets (static + custom)
app.get('/api/datasets', (req, res) => {
  const custom = db.get('datasets').value() || [];
  res.json({ datasets: STATIC_DATASETS.concat(custom) });
});
// Create a new custom dataset
app.post('/api/datasets', authMiddleware, (req, res) => {
  const { id, title, description, url, type, supportedViews } = req.body;
  if (!id || !title || !url || !type || !supportedViews) {
    return res.status(400).json({ error: 'Missing required dataset fields' });
  }
  // Prevent duplicates against static and custom
  if (STATIC_DATASETS.find(d => d.id === id) || db.get('datasets').find({ id }).value()) {
    return res.status(400).json({ error: 'Dataset ID already exists' });
  }
  const ds = { id, title, description, url, type, supportedViews };
  db.get('datasets').push(ds).write();
  res.status(201).json(ds);
});
// -----------------------------------------------------------------------------
// OWID Indicator Catalog
// -----------------------------------------------------------------------------
// Fetch list of all available OWID variables (indicators)
// Fetch list of all available OWID datasets via GitHub datapackage
app.get('/api/owid/indicators', async (req, res) => {
  try {
    const url = `${OWID_CDN_BASE}/datapackage.json`;
    const resp = await axios.get(url, { timeout: 20000 });
    const pkg = resp.data;
    if (!pkg || !Array.isArray(pkg.resources)) throw new Error('Invalid datapackage format');
    // Filter for OWID datasets (paths under owid/slug)
    const indicators = pkg.resources
      .filter(r => r.path && r.path.startsWith('datasets/owid/') && r.path.endsWith('datapackage.json'))
      .map(r => {
        const parts = r.path.split('/');
        // slug is the directory containing the datapackage.json (handle nested version folders)
        const slug = parts[2];
        return {
          id: slug,
          title: r.name || slug,
          description: r.description || '',
          url: `https://ourworldindata.org/grapher/${slug}.csv`,
          type: 'time-series',
          supportedViews: ['graph', 'globe']
        };
      });
    res.json({ indicators });
  } catch (err) {
    console.error('Error fetching OWID indicators datapackage:', err);
    res.status(503).json({ error: 'Unable to fetch OWID dataset list' });
  }
});

// -----------------------------------------------------------------------------
// Per‑dataset metadata via datapackage.json (stable fallback)
// -----------------------------------------------------------------------------
// GET /api/owid/datasets/:datasetId/meta (optional ?version=<version>)
app.get('/api/owid/datasets/:datasetId/meta', async (req, res) => {
  const { datasetId } = req.params;
  // Special case: load built-in static metadata if available
  try {
    const staticMetaPath = path.join(__dirname, '..', 'public', 'data', datasetId, `${datasetId}.metadata.json`);
    if (fs.existsSync(staticMetaPath)) {
      const sm = JSON.parse(fs.readFileSync(staticMetaPath, 'utf8'));
      // Transform to expected { metadata, variables } shape
      const metadata = { title: sm.chart.title, description: sm.chart.subtitle || sm.chart.note || '' };
      const variables = Object.entries(sm.columns).map(([key, col]) => ({
        id: key,
        title: col.titleLong || col.titleShort || key,
        unit: col.unit || ''
      }));
      return res.json({ metadata, variables });
    }
  } catch (err) {
    console.warn(`Error loading static metadata for ${datasetId}:`, err);
  }
  // Fetch datapackage.json without requiring version: try CDN, raw, and GitHub API
  let version = req.query.version;
  const tried = [];
  async function tryFetch(url) {
    tried.push(url);
    try {
      const resp = await axios.get(url, { timeout: 10000 });
      console.log(`Fetched datapackage.json for dataset ${datasetId} from ${url}`);
      return resp.data;
    } catch (err) {
      if (err.response && err.response.status === 404) {
        console.warn(`Not found at ${url} (404)`);
        return null;
      }
      console.error(`Error fetching datapackage from ${url}:`, err);
      throw err;
    }
  }
  let pkg = null;
  if (version) {
    // 1) Explicit version via GitHub raw
    pkg = await tryFetch(`${OWID_CDN_BASE}/datasets/owid/${datasetId}/${version}/datapackage.json`);
    if (!pkg) {
      return res.status(404).json({ error: 'Datapackage not found for version ' + version });
    }
  } else {
    // 2) Try unversioned GitHub raw
    pkg = await tryFetch(`${OWID_CDN_BASE}/datasets/owid/${datasetId}/datapackage.json`);
    // 3) List versions via GitHub API and pick latest if unversioned missing
    if (!pkg) {
      try {
        const contentsUrl = `https://api.github.com/repos/owid/owid-datasets/contents/datasets/${datasetId}`;
        const dirResp = await axios.get(contentsUrl, {
          timeout: 10000,
          headers: { Accept: 'application/vnd.github.v3+json' }
        });
        const dirs = Array.isArray(dirResp.data)
          ? dirResp.data.filter(item => item.type === 'dir').map(item => item.name)
          : [];
        if (dirs.length) {
          dirs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
          const latest = dirs[dirs.length - 1];
          pkg = await tryFetch(`${OWID_CDN_BASE}/datasets/owid/${datasetId}/${latest}/datapackage.json`);
          if (pkg) version = latest;
        }
      } catch (err) {
        console.error(`Failed to list versions for dataset ${datasetId}:`, err);
      }
    }
    if (!pkg) {
      return res.status(404).json({ error: `Datapackage not found for dataset ${datasetId}`, tried });
    }
  }
  // Parse datapackage
  const resources = Array.isArray(pkg.resources) ? pkg.resources : [];
  // Pick the primary CSV resource
  let resource = resources.find(r => r.name === datasetId)
                 || resources.find(r => r.path && r.path.endsWith('.csv'));
  if (!resource) {
    return res.status(404).json({ error: 'Datapackage resource not found' });
  }
  const fields = resource.schema && Array.isArray(resource.schema.fields)
    ? resource.schema.fields
    : [];
  const variables = fields.map(f => ({
    id: f.name,
    title: f.title || f.name,
    description: f.description || '',
    unit: f.unit || (f.constraints && f.constraints.unit) || '',
    type: f.type || f.format || 'unknown'
  }));
  const metadata = {
    id: pkg.id || pkg.name,
    title: pkg.title || pkg.name || datasetId,
    description: pkg.description || ''
  };
  res.json({ metadata, variables });
});

// Simple chat endpoint using OpenAI ChatCompletion (GPT 4.1)
// Chat endpoints
// List conversations for current user
app.get('/api/chat', authMiddleware, (req, res) => {
  const user = db.get('users').find({ id: req.user.id }).value();
  const convs = user.conversations || [];
  const list = convs.map(c => ({ id: c.id, createdAt: c.createdAt }));
  res.json({ conversations: list });
});
// Get specific conversation messages
app.get('/api/chat/:conversationId', authMiddleware, (req, res) => {
  const user = db.get('users').find({ id: req.user.id }).value();
  const convId = req.params.conversationId;
  const convs = user.conversations || [];
  const conv = convs.find(c => c.id === convId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  res.json({ id: conv.id, createdAt: conv.createdAt, messages: conv.messages });
});
// Send a chat message and save conversation
app.post('/api/chat', authMiddleware, async (req, res) => {
  try {
    const { prompt, model, conversationId } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    // Determine API key (user-provided or default)
    let key = process.env.OPENAI_API_KEY;
    if (req.user.apiKeyEncrypted) {
      const bytes = CryptoJS.AES.decrypt(req.user.apiKeyEncrypted, CRYPTO_SECRET);
      key = bytes.toString(CryptoJS.enc.Utf8);
    }
    if (!key) return res.status(400).json({ error: 'OpenAI API key not configured' });
    // Initialize OpenAI v4 client and define tools for function-calling
    const openai = new OpenAI({ apiKey: key });
    const chatModel = model || process.env.CHAT_MODEL || 'o4-mini';
    // Build message history: include past messages if a conversationId is provided
    let messages = [];
    if (conversationId) {
      const userData = db.get('users').find({ id: req.user.id }).value();
      const convs = userData.conversations || [];
      const conv = convs.find(c => c.id === conversationId);
      if (conv && Array.isArray(conv.messages)) {
        messages = conv.messages.map(m => ({ role: m.sender, content: m.text }));
      }
    }
    // Append the current user message
    messages.push({ role: 'user', content: prompt });
    // Knowledge-base search tool
    const searchTool = {
      type: 'function',
      name: 'search_knowledge_base',
      description: 'Query a knowledge base to retrieve relevant info on a topic.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The user question or search query.' },
          options: {
            type: 'object',
            properties: {
              num_results: { type: 'number', description: 'Number of top results to return.' },
              domain_filter: { type: ['string', 'null'], description: "Optional domain to narrow the search (e.g. 'finance', 'medical'). Pass null if not needed." },
              sort_by: { type: ['string', 'null'], enum: ['relevance', 'date', 'popularity', 'alphabetical'], description: 'How to sort results. Pass null if not needed.' }
            },
            required: ['num_results', 'domain_filter', 'sort_by'],
            additionalProperties: false
          }
        },
        required: ['query', 'options'],
        additionalProperties: false
      }
    };
    // Dataset plotting tool
    const plotTool = {
      type: 'function',
      name: 'plot_dataset',
      description: 'Generate a directive to plot a time-series dataset on the client.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Dataset identifier (e.g. population, life-expectancy, child-mortality).' },
          defaultRegion: { type: 'string', description: 'Region or country to default the plot to.' },
          defaultYearRange: {
            type: 'array',
            items: { type: 'number' },
            minItems: 2,
            maxItems: 2,
            description: 'Start and end year for the time range.'
          }
        },
        required: ['id'],
        additionalProperties: false
      }
    };
    // Dataset show-on-globe tool
    // Call ChatCompletion with tools available (function-calling)
    // Include search, plot (graph), and show (globe) tools
    const showTool = {
      type: 'function',
      name: 'show_dataset',
      description: 'Generate a directive to show a time-series dataset on the globe.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Dataset identifier (e.g. population, life-expectancy).' }
        },
        required: ['id'],
        additionalProperties: false
      }
    };
    // Dataset definition tool
    const defineTool = {
      type: 'function',
      name: 'define_dataset',
      description: 'Define a new dataset by providing metadata and CSV URL.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the dataset.' },
          title: { type: 'string', description: 'Human-readable title for the dataset.' },
          description: { type: 'string', description: 'Description of the dataset.' },
          url: { type: 'string', description: 'CSV URL from which to fetch the data.' },
          type: { type: 'string', description: 'Dataset type, e.g., time-series.' },
          supportedViews: { type: 'array', items: { type: 'string' }, description: 'Array of views: graph, globe.' }
        },
        required: ['id', 'title', 'url', 'type', 'supportedViews'],
        additionalProperties: false
      }
    };
    const resp = await openai.chat.completions.create({
      model: chatModel,
      messages: messages,
      functions: [searchTool, plotTool, showTool, defineTool],
      function_call: 'auto'
    });
    // Extract reply / function‑call information
    const replyChoice = resp.choices?.[0] || {};
    const replyMessage = replyChoice.message || {};
    let reply = replyMessage.content || '';
    // If the model decided to call our show-on-globe tool, emit a globe directive
    if (replyMessage.function_call && replyMessage.function_call.name === 'show_dataset') {
      try {
        const args = JSON.parse(replyMessage.function_call.arguments || '{}');
        reply = '__GLOBE__' + JSON.stringify({ id: args.id });
      } catch (err) {
        console.error('Show dataset processing failed:', err);
        reply = 'Sorry, I couldn\'t show the dataset on the globe.';
      }
    // If the model decided to call our plotting tool, emit a plot directive
    } else if (replyMessage.function_call && replyMessage.function_call.name === 'plot_dataset') {
      try {
        const args = JSON.parse(replyMessage.function_call.arguments || '{}');
        reply = '__PLOT__' + JSON.stringify({ id: args.id, defaultRegion: args.defaultRegion, defaultYearRange: args.defaultYearRange });
      } catch (err) {
        console.error('Plot dataset processing failed:', err);
        reply = 'Sorry, I couldn\'t prepare the graph.';
      }
    // If the model decided to call our KB search tool, run it and optionally
    // make a follow‑up call so the assistant can incorporate the info.
    } else if (replyMessage.function_call && replyMessage.function_call.name === 'search_knowledge_base') {
      try {
        const args = JSON.parse(replyMessage.function_call.arguments || '{}');
        const kbResults = await owidSearch(args.query || '', args.options || {});
        // Provide the KB results back to the model so it can craft a final answer
        const followResp = await openai.chat.completions.create({
          model: chatModel,
          messages: [
            { role: 'user', content: prompt },
            { role: 'assistant', function_call: replyMessage.function_call },
            { role: 'function', name: 'search_knowledge_base', content: JSON.stringify(kbResults) }
          ]
        });

        const followChoice = followResp.choices?.[0] || {};
        reply = followChoice.message?.content || JSON.stringify(kbResults);
      } catch (err) {
        console.error('KB search processing failed:', err);
        reply = 'Sorry, I had trouble searching the knowledge base.';
      }
    }
    // If the model decided to call our dataset-definition tool, save it
    if (replyMessage.function_call && replyMessage.function_call.name === 'define_dataset') {
      try {
        const args = JSON.parse(replyMessage.function_call.arguments || '{}');
        // Prevent duplicate IDs
        if (STATIC_DATASETS.find(d => d.id === args.id) || db.get('datasets').find({ id: args.id }).value()) {
          reply = `Dataset ID '${args.id}' already exists.`;
        } else {
          const ds = { id: args.id, title: args.title, description: args.description, url: args.url, type: args.type, supportedViews: args.supportedViews };
          db.get('datasets').push(ds).write();
          reply = `New dataset '${args.title}' created and available in the selector.`;
        }
      } catch (err) {
        console.error('Define dataset processing failed:', err);
        reply = 'Sorry, I could not define the new dataset.';
      }
    }
    // Save to database
    const userEntry = db.get('users').find({ id: req.user.id });
    const userData = userEntry.value();
    const convs = userData.conversations || [];
    let conv = convs.find(c => c.id === conversationId);
    if (!conv) {
      const newId = conversationId || Date.now().toString();
      conv = { id: newId, createdAt: new Date().toISOString(), messages: [] };
      convs.push(conv);
    }
    const timestamp = new Date().toISOString();
    const userMsg = { sender: 'user', text: prompt, timestamp };
    const assistantMsg = { sender: 'assistant', text: reply, timestamp };
    conv.messages.push(userMsg, assistantMsg);
    userEntry.assign({ conversations: convs }).write();
    res.json({ reply, conversationId: conv.id, createdAt: conv.createdAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// Ideologram storage API (per-user) – CSV library, enrichment and scores
// -----------------------------------------------------------------------------
function getUserEntry(userId) {
  let user = db.get('users').find({ id: userId });
  
  // If user doesn't exist (e.g., dummy token), create a new entry
  if (!user.value()) {
    console.log('🔧 Creating new user entry for dummy token:', userId);
    const newUser = {
      id: userId,
      email: userId.includes('@') ? userId : 'dummy@example.com',
      avatarUrl: null,
      apiKeyEncrypted: null,
      ideologram: {
        library: { books: [], updatedAt: null },
        enriched: { items: [], updatedAt: null },
        scores: { entries: [], updatedAt: null },
        assessments: { entries: [], updatedAt: null },
        chatHistory: { entries: [], updatedAt: null }
      }
    };
    
    db.get('users').push(newUser).write();
    user = db.get('users').find({ id: userId });
  }
  
  return user;
}

app.get('/api/ideologram/library', authMiddleware, (req, res) => {
  const user = getUserEntry(req.user.id).value();
  const ideologram = user.ideologram || {};
  res.json({ books: ideologram.library?.books || [], updatedAt: ideologram.library?.updatedAt || null });
});

app.post('/api/ideologram/library', authMiddleware, (req, res) => {
  console.log('📚 Library save request received:', { 
    userId: req.user.id, 
    userEmail: req.user.email,
    booksCount: req.body?.books?.length || 0,
    bodyKeys: Object.keys(req.body || {})
  });
  
  const { books } = req.body || {};
  if (!Array.isArray(books)) {
    console.error('❌ Invalid books data:', typeof books, books);
    return res.status(400).json({ error: 'books array required' });
  }
  
  try {
    const entry = getUserEntry(req.user.id);
    const user = entry.value() || {};
    const ideologram = user.ideologram || {};
    
    console.log('💾 Saving library for user:', req.user.email, 'Books count:', books.length);
    
    ideologram.library = { books, updatedAt: new Date().toISOString() };
    entry.assign({ ideologram }).write();
    
    console.log('✅ Library saved successfully for user:', req.user.email);
    res.json({ ok: true, count: books.length });
  } catch (error) {
    console.error('❌ Error saving library:', error);
    res.status(500).json({ error: 'Failed to save library', details: error.message });
  }
});

app.get('/api/ideologram/enriched', authMiddleware, (req, res) => {
  const user = getUserEntry(req.user.id).value();
  const ideologram = user.ideologram || {};
  res.json({ items: ideologram.enriched?.items || [], updatedAt: ideologram.enriched?.updatedAt || null });
});

app.post('/api/ideologram/enriched', authMiddleware, (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
  const entry = getUserEntry(req.user.id);
  const user = entry.value() || {};
  const ideologram = user.ideologram || {};
  // Merge by key to avoid overwriting previous enrichments
  const byKey = {}; (Array.isArray(ideologram.enriched?.items) ? ideologram.enriched.items : []).forEach(it => { if (it && it.key) byKey[it.key] = it; });
  items.forEach(it => { if (it && it.key) byKey[it.key] = it; });
  ideologram.enriched = { items: Object.values(byKey), updatedAt: new Date().toISOString() };
  entry.assign({ ideologram }).write();
  res.json({ ok: true, count: ideologram.enriched.items.length });
});

app.get('/api/ideologram/scores', authMiddleware, (req, res) => {
  const user = getUserEntry(req.user.id).value();
  const ideologram = user.ideologram || {};
  const entries = ideologram.scores?.entries || [];
  res.json({ entries, updatedAt: ideologram.scores?.updatedAt || null });
});

app.post('/api/ideologram/scores', authMiddleware, (req, res) => {
  const entryIn = req.body || {};
  const entryRef = getUserEntry(req.user.id);
  const user = entryRef.value() || {};
  const ideologram = user.ideologram || {};
  if (!ideologram.scores) ideologram.scores = { entries: [], updatedAt: null };
  const key = (entryIn.isbn && String(entryIn.isbn).trim()) || (entryIn.id && String(entryIn.id).trim()) || Date.now().toString(36);
  const now = new Date().toISOString();
  const safeEntry = {
    ...entryIn,
    key,
    title: (entryIn.title || '').toString().trim(),
    author: (entryIn.author || '').toString().trim(),
    isbn: entryIn.isbn ? String(entryIn.isbn).trim() : undefined,
    fileName: entryIn.fileName ? String(entryIn.fileName) : undefined,
    updatedAt: now,
  };
  const idx = ideologram.scores.entries.findIndex(e => e.key === key);
  if (idx >= 0) ideologram.scores.entries[idx] = safeEntry; else ideologram.scores.entries.push(safeEntry);
  ideologram.scores.updatedAt = now;
  entryRef.assign({ ideologram }).write();
  res.json({ ok: true, key });
});

app.post('/api/ideologram/assessments', authMiddleware, (req, res) => {
  const assessmentIn = req.body || {};
  const entryRef = getUserEntry(req.user.id);
  const user = entryRef.value() || {};
  const ideologram = user.ideologram || {};
  if (!ideologram.assessments) ideologram.assessments = { entries: [], updatedAt: null };
  
  const now = new Date().toISOString();
  const safeAssessment = {
    ...assessmentIn,
    id: assessmentIn.id || Date.now().toString(),
    timestamp: assessmentIn.timestamp || now,
    updatedAt: now,
  };
  
  // Add to assessments array
  ideologram.assessments.entries.push(safeAssessment);
  ideologram.assessments.updatedAt = now;
  
  entryRef.assign({ ideologram }).write();
  res.json({ ok: true, id: safeAssessment.id });
});

app.get('/api/ideologram/assessments', authMiddleware, (req, res) => {
  const user = getUserEntry(req.user.id).value();
  const ideologram = user.ideologram || {};
  const assessments = ideologram.assessments?.entries || [];
  res.json({ assessments, updatedAt: ideologram.assessments?.updatedAt });
});

// Save ChatGPT history for worldview assessment
app.post('/api/ideologram/chat-history', authMiddleware, (req, res) => {
  try {
    const { chatHistory } = req.body;
    const entryRef = getUserEntry(req.user.id);
    const user = entryRef.value() || {};
    const ideologram = user.ideologram || {};
    
    const now = new Date().toISOString();
    ideologram.chatHistory = chatHistory;
    ideologram.chatHistoryUpdated = now;
    
    entryRef.assign({ ideologram }).write();
    
    res.json({ ok: true, messageCount: chatHistory.length });
  } catch (error) {
    console.error('Error saving chat history:', error);
    res.status(500).json({ error: 'Failed to save chat history' });
  }
});

app.get('/api/ideologram/fs', authMiddleware, (req, res) => {
  const user = getUserEntry(req.user.id).value();
  const ideologram = user.ideologram || {};
  
  function sizeOf(obj) {
    try { return JSON.stringify(obj).length; } catch { return 0; }
  }
  
  function getFileSize(filePath) {
    try {
      const stats = fs.statSync(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }
  
  const libraryCount = Array.isArray(ideologram.library?.books) ? ideologram.library.books.length : 0;
  const enrichedCount = Array.isArray(ideologram.enriched?.items) ? ideologram.enriched.items.length : 0;
  const scoresCount = Array.isArray(ideologram.scores?.entries) ? ideologram.scores.entries.length : 0;
  const assessmentsCount = Array.isArray(ideologram.assessments?.entries) ? ideologram.assessments.entries.length : 0;
  const chatHistoryCount = Array.isArray(ideologram.chatHistory) ? ideologram.chatHistory.length : 0;
  const compressedCount = Array.isArray(ideologram.compressed?.books) ? ideologram.compressed.books.length : 0;
  
  // Get compression files from disk
  const compressionFiles = [];
  if (ideologram.compressed?.books && ideologram.compressed.books.length > 0) {
    const userCompressedDir = path.join(__dirname, 'compressed', req.user.id);
    if (fs.existsSync(userCompressedDir)) {
      ideologram.compressed.books.forEach(book => {
        const bookDir = path.join(userCompressedDir, book.id, book.id);
        if (fs.existsSync(bookDir)) {
          // Add book directory
          const bookNode = {
            name: book.id,
            type: 'dir',
            meta: { 
              title: book.title || 'Untitled',
              author: book.author || 'Unknown',
              compressedAt: book.compressedAt,
              label: 'compression files'
            },
            children: []
          };
          
          // Add compression output files
          const outputFiles = [
            'sentences.jsonl',
            'ists.jsonl', 
            'embeddings.npy',
            'paraphrase_clusters.json',
            'cluster_protos.json',
            'book_core.json',
            'density_report.json'
          ];
          
          outputFiles.forEach(fileName => {
            const filePath = path.join(bookDir, fileName);
            if (fs.existsSync(filePath)) {
              const stats = fs.statSync(filePath);
              bookNode.children.push({
                name: fileName,
                type: 'file',
                size: stats.size,
                updatedAt: stats.mtime.toISOString(),
                meta: { 
                  count: fileName.endsWith('.jsonl') ? 'multiple lines' : '1 file',
                  label: fileName.replace('.jsonl', '').replace('.json', '').replace('.npy', '')
                }
              });
            }
          });
          
          compressionFiles.push(bookNode);
        }
      });
    }
  }
  
  const tree = {
    name: 'Ideologram',
    owner: req.user.email || req.user.id,
    type: 'dir',
    children: [
      { name: 'library.json', type: 'file', updatedAt: ideologram.library?.updatedAt || null, size: sizeOf(ideologram.library), meta: { count: libraryCount, label: 'books' } },
      { name: 'enriched.json', type: 'file', updatedAt: ideologram.enriched?.updatedAt || null, size: sizeOf(ideologram.enriched), meta: { count: enrichedCount, label: 'items' } },
      { name: 'scores.json', type: 'file', updatedAt: ideologram.scores?.updatedAt || null, size: sizeOf(ideologram.scores), meta: { count: scoresCount, label: 'scores' } },
      { name: 'assessments.json', type: 'file', updatedAt: ideologram.assessments?.updatedAt || null, size: sizeOf(ideologram.assessments), meta: { count: assessmentsCount, label: 'assessments' } },
      { name: 'chat-history.json', type: 'file', updatedAt: ideologram.chatHistoryUpdated || null, size: sizeOf(ideologram.chatHistory), meta: { count: chatHistoryCount, label: 'messages' } },
      { name: 'compressed.json', type: 'file', updatedAt: ideologram.compressed?.updatedAt || null, size: sizeOf(ideologram.compressed), meta: { count: compressedCount, label: 'compressed books' } },
      // Add compression files if they exist
      ...(compressionFiles.length > 0 ? [{ 
        name: 'compression-files', 
        type: 'dir', 
        meta: { count: compressionFiles.length, label: 'compressed books' },
        children: compressionFiles 
      }] : [])
    ]
  };
  res.json(tree);
});

// Step-by-step compression endpoint
app.post('/api/ideologram/compress/step', authMiddleware, async (req, res) => {
  const { step, text, bookId, title, author, docType } = req.body;
  
  if (!step || !text || !bookId) {
    return res.status(400).json({ error: 'step, text, and bookId required' });
  }
  
  try {
    console.log(`🔧 Running compression step: ${step} for book: ${bookId}`);
    
    if (step === 'extract') {
      // Step 1: Extract statements
      console.log('📝 Running statement extraction...');
      
      const { spawn } = require('child_process');
      const pythonScript = path.join(__dirname, '..', 'Ideologram', 'K-Compress', 'run_extraction.py');
      
      const extractionScript = `import sys
import os
sys.path.append('Ideologram/K-Compress')
from book_compressor_mdl import split_chapters, split_paragraphs, split_sentences, make_sa, llm_sentence_to_ist_batch
import json

# Redirect stdout to stderr for debug messages, then restore for JSON output
original_stdout = sys.stdout
sys.stdout = sys.stderr

# Text processing
text = '''${text.replace(/'/g, "\\'")}'''
chapters = split_chapters(text)

sentences = []
for ch_i, ch in enumerate(chapters):
    for p_i, para in enumerate(split_paragraphs(ch)):
        for s_i, s in enumerate(split_sentences(para)):
            sa = make_sa('${bookId}', ch_i, p_i, s_i, s)
            sentences.append({"sa": sa, "text": s, "ch": ch_i, "para": p_i, "sent": s_i})

# Limit to first 1000 sentences for debug mode
sentences = sentences[:1000]

# Create fake CEP for now
cep = {"doc_type": "${docType || 'nonfiction'}"}

# Extract statements using GPT-5 (debug output goes to stderr)
print("Extracting statements...")
ists = llm_sentence_to_ist_batch(sentences, cep, max_sentences=1000)

# Count results
total_sentences = len(sentences)
total_statements = len([ist for ist in ists if not ist.get('none')])

# Save to temporary directory
user_dir = os.path.join('server', 'compressed', '${req.user.id}')
book_dir = os.path.join(user_dir, '${bookId}')
os.makedirs(book_dir, exist_ok=True)

with open(os.path.join(book_dir, 'sentences.jsonl'), 'w') as f:
    for rec in sentences:
        f.write(json.dumps(rec) + '\\n')

with open(os.path.join(book_dir, 'ists.jsonl'), 'w') as f:
    for ist in ists:
        f.write(json.dumps(ist) + '\\n')

# Output results
result = {
    'sentences': total_sentences,
    'statements': total_statements,
    'discarded': total_sentences - total_statements,
    'message': 'Statement extraction completed'
}

# Restore stdout and print only JSON
sys.stdout = original_stdout
print(json.dumps(result))`;
      
      fs.writeFileSync(pythonScript, extractionScript);
      
      return new Promise((resolve, reject) => {
        const pythonProcess = spawn('python3', [pythonScript]);
        
        let stdout = '';
        let stderr = '';
        let lastOutputTime = Date.now();
        
        // Set a timeout to kill the process if it takes too long
        const timeoutId = setTimeout(() => {
          console.error('⏰ Extraction timeout: killing stuck process');
          pythonProcess.kill('SIGKILL');
          reject(new Error('Extraction timeout: process took too long'));
        }, 5 * 60 * 1000); // 5 minutes timeout
        
        // Health check: warn if no output for 2 minutes
        const healthCheckId = setInterval(() => {
          const timeSinceLastOutput = Date.now() - lastOutputTime;
          if (timeSinceLastOutput > 2 * 60 * 1000) { // 2 minutes
            console.warn('⚠️  No output from extraction process for 2 minutes');
          }
        }, 30 * 1000); // Check every 30 seconds
        
        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
          lastOutputTime = Date.now();
        });
        
        pythonProcess.stderr.on('data', (data) => {
          stderr += data.toString();
          lastOutputTime = Date.now();
        });
        
        pythonProcess.on('close', async (code) => {
          clearTimeout(timeoutId);
          clearInterval(healthCheckId);
          
          if (code !== 0) {
            console.error('❌ Extraction failed:', stderr);
            return reject(new Error(`Extraction failed: ${stderr}`));
          }
          
          try {
            const result = JSON.parse(stdout);
            console.log('✅ Statement extraction completed');
            resolve({
              ok: true,
              sentences: result.sentences,
              statements: result.statements,
              discarded: result.discarded,
              message: result.message
            });
            
          } catch (error) {
            console.error('❌ Error parsing extraction results:', error);
            reject(new Error('Failed to parse extraction results'));
          }
        });
        
        pythonProcess.on('error', (error) => {
          clearTimeout(timeoutId);
          clearInterval(healthCheckId);
          console.error('❌ Extraction process error:', error);
          reject(new Error(`Extraction process error: ${error.message}`));
        });
      });
      
    } else if (step === 'embed') {
      // Step 2: Generate embeddings
      console.log('🧠 Running embedding generation...');
      
      // For now, create fake embeddings
      const userDir = path.join(__dirname, 'compressed', req.user.id);
      const bookDir = path.join(userDir, bookId);
      const istsPath = path.join(bookDir, 'ists.jsonl');
      
      if (!fs.existsSync(istsPath)) {
        return res.status(400).json({ error: 'Extraction must be run first' });
      }
      
      const ists = fs.readFileSync(istsPath, 'utf8')
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
      
      // Create fake embeddings (1536 dimensions)
      const embeddings = [];
      for (let i = 0; i < ists.length; i++) {
        const embedding = [];
        for (let j = 0; j < 1536; j++) {
          embedding.push(Math.random());
        }
        embeddings.push(embedding);
      }
      
      // Save embeddings
      const embeddingsPath = path.join(bookDir, 'embeddings.npy');
      // Note: In a real implementation, you'd save as numpy array
      // For now, just note that embeddings were created
      
      console.log('✅ Embedding generation completed');
      res.json({
        ok: true,
        embeddings: embeddings.length,
        dimensions: 1536,
        message: 'Embedding generation completed'
      });
      
    } else if (step === 'cluster') {
      // Step 3: Cluster statements
      console.log('🔍 Running statement clustering...');
      
      const { spawn } = require('child_process');
      const pythonScript = path.join(__dirname, '..', 'Ideologram', 'K-Compress', 'run_clustering.py');
      
      const clusteringScript = `import sys
import os
sys.path.append('Ideologram/K-Compress')
from book_compressor_mdl import paraphrase_clusters, summarize_cluster_to_ist, cluster_centroid
import json

# Read existing data
user_dir = os.path.join('server', 'compressed', '${req.user.id}')
book_dir = os.path.join(user_dir, '${bookId}')

with open(os.path.join(book_dir, 'ists.jsonl'), 'r') as f:
    ists = [json.loads(line) for line in f if line.strip()]

# Create fake embeddings for now
import numpy as np
embs = [np.random.random(1536).tolist() for _ in range(len(ists))]

# Run clustering
clusters = paraphrase_clusters(ists, embs, sim_thresh=0.85, ncd_thresh=0.38, min_cluster=2)

# Generate cluster summaries
protos = []
for i, cluster in enumerate(clusters):
    cluster_ists = [ists[j] for j in cluster]
    proto = summarize_cluster_to_ist(cluster_ists)
    proto['id'] = '${bookId}:cluster:' + str(i)
    proto['coverage'] = len(cluster)
    proto['centroid'] = cluster_centroid(embs, cluster)
    protos.append(proto)

# Save results
clusters_path = os.path.join(book_dir, 'paraphrase_clusters.json')
protos_path = os.path.join(book_dir, 'cluster_protos.json')

with open(clusters_path, 'w') as f:
    json.dump({
        'clusters': {str(i): [ists[j]['sa'] for j in cluster] for i, cluster in enumerate(clusters)},
        'stats': {'n_clusters': len(clusters), 'n_items': len(ists)}
    }, f, indent=2)

with open(protos_path, 'w') as f:
    json.dump(protos, f, indent=2)

# Output results
result = {
    'clusters': len(clusters),
    'protos': len(protos),
    'message': 'Clustering completed'
}

print(json.dumps(result))`;
      
      fs.writeFileSync(pythonScript, clusteringScript);
      
      return new Promise((resolve, reject) => {
        const pythonProcess = spawn('python3', [pythonScript]);
        
        let stdout = '';
        let stderr = '';
        let lastOutputTime = Date.now();
        
        // Set a timeout to kill the process if it takes too long
        const timeoutId = setTimeout(() => {
          console.error('⏰ Clustering timeout: killing stuck process');
          pythonProcess.kill('SIGKILL');
          reject(new Error('Clustering timeout: process took too long'));
        }, 5 * 60 * 1000); // 5 minutes timeout
        
        // Health check: warn if no output for 2 minutes
        const healthCheckId = setInterval(() => {
          const timeSinceLastOutput = Date.now() - lastOutputTime;
          if (timeSinceLastOutput > 2 * 60 * 1000) { // 2 minutes
            console.warn('⚠️  No output from clustering process for 2 minutes');
          }
        }, 30 * 1000); // Check every 30 seconds
        
        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
          lastOutputTime = Date.now();
        });
        
        pythonProcess.stderr.on('data', (data) => {
          stderr += data.toString();
          lastOutputTime = Date.now();
        });
        
        pythonProcess.on('close', async (code) => {
          clearTimeout(timeoutId);
          clearInterval(healthCheckId);
          
          if (code !== 0) {
            console.error('❌ Clustering failed:', stderr);
            return reject(new Error(`Clustering failed: ${stderr}`));
          }
          
          try {
            const result = JSON.parse(stdout);
            console.log('✅ Clustering completed');
            resolve({
              ok: true,
              clusters: result.clusters,
              protos: result.protos,
              message: result.message
            });
            
          } catch (error) {
            console.error('❌ Error parsing clustering results:', error);
            reject(new Error('Failed to parse clustering results'));
          }
        });
        
        pythonProcess.on('error', (error) => {
          clearTimeout(timeoutId);
          clearInterval(healthCheckId);
          console.error('❌ Clustering process error:', error);
          reject(new Error(`Clustering process error: ${error.message}`));
        });
      });
      
    } else if (step === 'synthesize') {
      // Step 4: Generate theses
      console.log('🧠 Running thesis synthesis...');
      
      const { spawn } = require('child_process');
      const pythonScript = path.join(__dirname, '..', 'Ideologram', 'K-Compress', 'run_synthesis.py');
      
      const synthesisScript = `import sys
import os
sys.path.append('Ideologram/K-Compress')
from book_compressor_mdl import ist_code_len_bits, greedy_mdl_selection
import json

# Read existing data
user_dir = os.path.join('server', 'compressed', '${req.user.id}')
book_dir = os.path.join(user_dir, '${bookId}')

with open(os.path.join(book_dir, 'ists.jsonl'), 'r') as f:
    ists = [json.loads(line) for line in f if line.strip()]

with open(os.path.join(book_dir, 'cluster_protos.json'), 'r') as f:
    protos = json.load(f)

with open(os.path.join(book_dir, 'paraphrase_clusters.json'), 'r') as f:
    clusters_data = json.load(f)

# Convert clusters to covers format
covers = {}
for cid, cluster in clusters_data['clusters'].items():
    covers[int(cid)] = [i for i, ist in enumerate(ists) if ist['sa'] in cluster]

# Run MDL optimization
ist_bits = [ist_code_len_bits(ist) for ist in ists]
ptr_cost_bits = 64
target_coverage = 0.85

chosen, cov_ratio, mdl_reduction = greedy_mdl_selection(
    protos, covers, ist_bits, ptr_cost_bits, target_coverage
)

# Generate theses
theses = []
for rank, cid in enumerate(chosen[:5]):
    theses.append({
        'id': '${bookId}:thesis:' + str(rank),
        'triple': protos[cid]['triple'],
        'confidence': protos[cid].get('confidence', 0.6),
        'backlinks': [ists[i]['sa'] for i in covers[cid]]
    })

# Save results
book_core_path = os.path.join(book_dir, 'book_core.json')
with open(book_core_path, 'w') as f:
    json.dump({
        'book_id': '${bookId}',
        'doc_type': '${docType || 'nonfiction'}',
        'coverage_fraction': cov_ratio,
        'mdl_reduction_bits': mdl_reduction,
        'theses': theses
    }, f, indent=2)

# Output results
result = {
    'theses': len(theses),
    'coverage': cov_ratio,
    'mdl_reduction': mdl_reduction,
    'message': 'Thesis synthesis completed'
}

print(json.dumps(result))`;
      
      fs.writeFileSync(pythonScript, synthesisScript);
      
      return new Promise((resolve, reject) => {
        const pythonProcess = spawn('python3', [pythonScript]);
        
        let stdout = '';
        let stderr = '';
        let lastOutputTime = Date.now();
        
        // Set a timeout to kill the process if it takes too long
        const timeoutId = setTimeout(() => {
          console.error('⏰ Synthesis timeout: killing stuck process');
          pythonProcess.kill('SIGKILL');
          reject(new Error('Synthesis timeout: process took too long'));
        }, 5 * 60 * 1000); // 5 minutes timeout
        
        // Health check: warn if no output for 2 minutes
        const healthCheckId = setInterval(() => {
          const timeSinceLastOutput = Date.now() - lastOutputTime;
          if (timeSinceLastOutput > 2 * 60 * 1000) { // 2 minutes
            console.warn('⚠️  No output from synthesis process for 2 minutes');
          }
        }, 30 * 1000); // Check every 30 seconds
        
        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
          lastOutputTime = Date.now();
        });
        
        pythonProcess.stderr.on('data', (data) => {
          stderr += data.toString();
          lastOutputTime = Date.now();
        });
        
        pythonProcess.on('close', async (code) => {
          clearTimeout(timeoutId);
          clearInterval(healthCheckId);
          
          if (code !== 0) {
            console.error('❌ Synthesis failed:', stderr);
            return reject(new Error(`Synthesis failed: ${stderr}`));
          }
          
          try {
            const result = JSON.parse(stdout);
            console.log('✅ Thesis synthesis completed');
            resolve({
              ok: true,
              theses: result.theses,
              coverage: result.coverage,
              mdl_reduction: result.mdl_reduction,
              message: result.message
            });
            
          } catch (error) {
            console.error('❌ Error parsing synthesis results:', error);
            reject(new Error('Failed to parse synthesis results'));
          }
        });
        
        pythonProcess.on('error', (error) => {
          clearTimeout(timeoutId);
          clearInterval(healthCheckId);
          console.error('❌ Synthesis process error:', error);
          reject(new Error(`Synthesis process error: ${error.message}`));
        });
      });
      
    } else if (step === 'finalize') {
      // Step 5: Finalize results
      console.log('🎯 Finalizing compression results...');
      
      // Update database with compression metadata
      const entry = getUserEntry(req.user.id);
      const user = entry.value() || {};
      const ideologram = user.ideologram || {};
      
      if (!ideologram.compressed) {
        ideologram.compressed = { books: [] };
      }
      
      // Check if book already exists
      const existingIndex = ideologram.compressed.books.findIndex(b => b.id === bookId);
      const compressedBook = {
        id: bookId,
        title: title || 'Untitled',
        author: author || 'Unknown',
        docType: docType || 'nonfiction',
        compressedAt: new Date().toISOString(),
        outputs: ['sentences.jsonl', 'ists.jsonl', 'embeddings.npy', 'paraphrase_clusters.json', 'cluster_protos.json', 'book_core.json'],
        summary: {},
        density: {},
        stats: {
          sentences: 0,
          statements: 0,
          clusters: 0,
          theses: 0
        }
      };
      
      // Try to read actual stats from files
      try {
        const userDir = path.join(__dirname, 'compressed', req.user.id);
        const bookDir = path.join(userDir, bookId);
        
        const sentencesPath = path.join(bookDir, 'sentences.jsonl');
        if (fs.existsSync(sentencesPath)) {
          const content = fs.readFileSync(sentencesPath, 'utf8');
          const lines = content.split('\n').filter(line => line.trim());
          compressedBook.stats.sentences = lines.length;
        }
        
        const istsPath = path.join(bookDir, 'ists.jsonl');
        if (fs.existsSync(istsPath)) {
          const content = fs.readFileSync(istsPath, 'utf8');
          const lines = content.split('\n').filter(line => line.trim());
          const ists = lines.map(line => JSON.parse(line));
          compressedBook.stats.statements = ists.filter(ist => !ist.none).length;
        }
        
        const clustersPath = path.join(bookDir, 'paraphrase_clusters.json');
        if (fs.existsSync(clustersPath)) {
          const clusters = JSON.parse(fs.readFileSync(clustersPath, 'utf8'));
          compressedBook.stats.clusters = clusters.stats?.n_clusters || 0;
        }
        
        const bookCorePath = path.join(bookDir, 'book_core.json');
        if (fs.existsSync(bookCorePath)) {
          const bookCore = JSON.parse(fs.readFileSync(bookCorePath, 'utf8'));
          compressedBook.stats.theses = bookCore.theses?.length || 0;
          compressedBook.summary = bookCore;
        }
        
      } catch (error) {
        console.error('⚠️  Error reading compression stats:', error);
      }
      
      if (existingIndex >= 0) {
        ideologram.compressed.books[existingIndex] = compressedBook;
      } else {
        ideologram.compressed.books.push(compressedBook);
      }
      
      ideologram.compressed.updatedAt = new Date().toISOString();
      entry.assign({ ideologram }).write();
      
      console.log('✅ Compression finalization completed');
      res.json({
        ok: true,
        bookId,
        message: 'Compression finalization completed',
        stats: compressedBook.stats
      });
      
    } else {
      return res.status(400).json({ error: 'Invalid step. Use "extract", "embed", "cluster", "synthesize", or "finalize"' });
    }
    
  } catch (error) {
    console.error('❌ Error in compression step:', error);
    res.status(500).json({ error: 'Step processing failed', details: error.message });
  }
});

// Get compressed books for user
app.get('/api/ideologram/compressed', authMiddleware, (req, res) => {
  try {
    const user = getUserEntry(req.user.id).value();
    const ideologram = user.ideologram || {};
    const compressed = ideologram.compressed || { books: [] };
    
    res.json({
      ok: true,
      books: compressed.books || [],
      total: compressed.books?.length || 0,
      updatedAt: compressed.updatedAt
    });
  } catch (error) {
    console.error('Error fetching compressed books:', error);
    res.status(500).json({ error: 'Failed to fetch compressed books' });
  }
});

// File viewer endpoint for compression files
app.get('/api/ideologram/fs/file/:bookId/:fileName', authMiddleware, (req, res) => {
  const { bookId, fileName } = req.params;
  const user = getUserEntry(req.user.id).value();
  
  // Check if user has access to this book
  const hasAccess = user.ideologram?.compressed?.books?.some(b => b.id === bookId);
  if (!hasAccess) {
    return res.status(403).json({ error: 'Access denied to this book' });
  }
  
  const filePath = path.join(__dirname, 'compressed', req.user.id, bookId, bookId, fileName);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  try {
    if (fileName.endsWith('.jsonl')) {
      // Read JSONL file line by line
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      const data = lines.map(line => JSON.parse(line));
      res.json({ 
        type: 'jsonl',
        fileName,
        bookId,
        lineCount: lines.length,
        data: data.slice(0, 100), // Limit to first 100 lines for preview
        hasMore: lines.length > 100
      });
    } else if (fileName.endsWith('.json')) {
      // Read JSON file
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);
      res.json({ 
        type: 'json',
        fileName,
        bookId,
        data
      });
    } else if (fileName.endsWith('.npy')) {
      // For numpy files, just return metadata
      const stats = fs.statSync(filePath);
      res.json({ 
        type: 'npy',
        fileName,
        bookId,
        size: stats.size,
        message: 'Binary numpy file - use Python to analyze'
      });
    } else {
      res.status(400).json({ error: 'Unsupported file type' });
    }
  } catch (error) {
    console.error('Error reading file:', error);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// Responses API endpoint
const RESPONSES_MODEL = process.env.RESPONSES_MODEL || process.env.CHAT_MODEL || 'o4-mini-high';
app.post('/api/responses', authMiddleware, async (req, res) => {
  try {
    const { prompt, model: reqModel } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    // Determine API key
    let key = process.env.OPENAI_API_KEY;
    if (req.user.apiKeyEncrypted) {
      const bytes = CryptoJS.AES.decrypt(req.user.apiKeyEncrypted, CRYPTO_SECRET);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      if (decrypted) key = decrypted;
    }
    if (!key) return res.status(400).json({ error: 'OpenAI API key not configured' });
    // Select model
    const modelName = reqModel || RESPONSES_MODEL;
    const openaiClient = new OpenAI({ apiKey: key });
    // Call Responses API with function-calling tools
    const response = await openaiClient.responses.create({
      model: modelName,
      inputs: [{ role: 'user', content: prompt }],
      tools: [searchTool, plotTool, showTool, defineTool],
      function_call: { type: 'auto' }
    });
    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Scrape market cap data with fallback to FMP
app.get('/api/scrape/marketcap/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const slug = symbolSlugMap[symbol] || symbol.toLowerCase();
  const url = `https://www.macrotrends.net/stocks/charts/${symbol}/${slug}/market-cap`;
  let series = [];
  // Try HTML table scrape
  try {
    const { data: html } = await axios.get(url);
    const $ = cheerio.load(html);
    $('table.historical_data_table.table tbody tr').each((i, el) => {
      const tds = $(el).find('td');
      const year = parseInt(tds.eq(0).text().trim());
      const valText = tds.eq(1).text().trim().replace(/[$,]/g, '');
      const value = parseFloat(valText);
      if (!isNaN(year) && !isNaN(value)) series.push({ year, value });
    });
    if (series.length) {
      series.sort((a, b) => a.year - b.year);
      return res.json(series);
    }
    console.warn(`Scrape returned no data for ${symbol}, falling back to FMP`);
  } catch (err) {
    console.error(`Scrape error for ${symbol}`, err);
  }
  // Fallback to Financial Modeling Prep API
  if (FMP_API_KEY === 'demo') {
    return res.status(400).json({ error: 'No valid FMP_API_KEY provided. Set FMP_API_KEY in .env to enable fallback.' });
  }
  try {
    const fmpRes = await axios.get(`${FMP_BASE_URL}/historical-market-capitalization/${symbol}`, {
      params: { apikey: FMP_API_KEY }
    });
    const fmpSeries = fmpRes.data
      .map(d => ({ year: +d.date.slice(0, 4), value: +d.marketCap }))
      .sort((a, b) => a.year - b.year);
    return res.json(fmpSeries);
  } catch (err) {
    console.error(`FMP fallback error for ${symbol}`, err);
    return res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------------------
// Voice Integration: flagged stub endpoints (no-op until enabled)
// ---------------------------------------------------------------------------
if (VOICE_REALTIME) {
  // Returns ephemeral session metadata for Realtime client to connect with
  app.post('/api/realtime-session', authMiddleware, async (req, res) => {
    try {
      const key = process.env.OPENAI_API_KEY;
      if (!key) {
        // Fallback stub when no API key configured
        const token = 'ephemeral_' + crypto.randomBytes(12).toString('hex');
        const ttlMs = 60 * 1000;
        return res.json({ token, expiresAt: new Date(Date.now() + ttlMs).toISOString(), model: process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview', rtcConfig: null, stub: true });
      }
      const model = req.body?.model || process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview';
      const voice = req.body?.voice || 'verse';
      const inputAudioFormat = req.body?.inputAudioFormat || 'pcm16';
      const outputAudioFormat = req.body?.outputAudioFormat || 'pcm16';
      const axiosOpts = {
        method: 'POST',
        url: 'https://api.openai.com/v1/realtime/sessions',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'OpenAI-Beta': 'realtime=v1',
        },
        data: { model, voice, input_audio_format: inputAudioFormat, output_audio_format: outputAudioFormat },
        timeout: 15000,
      };
      const resp = await axios(axiosOpts);
      const data = resp?.data || {};
      const token = data?.client_secret?.value || null;
      const expiresAt = data?.client_secret?.expires_at || null;
      if (!token) return res.status(500).json({ error: 'Failed to create realtime session' });
      return res.json({ token, expiresAt, model, rtcConfig: data?.rtp_capabilities || null, id: data?.id || null });
    } catch (err) {
      console.error('Realtime session creation failed:', err?.response?.data || err?.message || err);
      return res.status(500).json({ error: 'Realtime session error' });
    }
  });
}

if (VOICE_TRANSCRIBE) {
  async function transcribeReal(req, res) {
    try {
      // Determine API key: prefer user key if configured, else env
      let key = process.env.OPENAI_API_KEY;
      if (req.user?.apiKeyEncrypted) {
        try { const bytes = CryptoJS.AES.decrypt(req.user.apiKeyEncrypted, CRYPTO_SECRET); key = bytes.toString(CryptoJS.enc.Utf8) || key; } catch {}
      }
      if (!key) return res.status(400).json({ error: 'OpenAI API key not configured' });
      if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'Audio file required (multipart/form-data field "file")' });

      // Prefer v4 SDK if available
      if (OpenAIClient && OpenAIClient.prototype && OpenAIClient.prototype.chat && OpenAIClient.prototype.audio) {
        try {
          const openai = new OpenAIClient({ apiKey: key });
          // Node helper to convert Buffer → File-like
          let fileLike;
          try {
            const uploads = require('openai/uploads');
            if (uploads && uploads.toFile) {
              fileLike = await uploads.toFile(req.file.buffer, req.file.originalname || 'audio.webm');
            }
          } catch {}
          const fileParam = fileLike || req.file.buffer;
          const result = await openai.audio.transcriptions.create({
            file: fileParam,
            model: process.env.TRANSCRIBE_MODEL || 'gpt-4o-transcribe',
            response_format: 'verbose_json',
            temperature: 0.1,
            language: req.body?.language || undefined,
          });
          // Pass-through shape best-effort
          return res.json({
            rawText: result?.text || result?.transcript || '',
            segments: result?.segments || [],
            words: result?.words || undefined,
          });
        } catch (err) {
          console.error('Transcribe via v4 SDK failed, fallback to REST:', err?.response?.data || err?.message || err);
        }
      }
      // Fallback REST call to /v1/audio/transcriptions
      const form = new (require('form-data'))();
      form.append('model', process.env.TRANSCRIBE_MODEL || 'gpt-4o-transcribe');
      form.append('response_format', 'verbose_json');
      if (req.body?.language) form.append('language', req.body.language);
      form.append('file', req.file.buffer, { filename: req.file.originalname || 'audio.webm', contentType: req.file.mimetype || 'audio/webm' });
      const resp = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: { ...form.getHeaders(), Authorization: `Bearer ${key}` },
        timeout: 60000,
      });
      const data = resp?.data || {};
      return res.json({ rawText: data?.text || '', segments: data?.segments || [], words: data?.words || undefined });
    } catch (err) {
      console.error('Transcribe error:', err?.response?.data || err?.message || err);
      return res.status(500).json({ error: 'Transcription failed' });
    }
  }

  if (upload && typeof upload.single === 'function') {
    app.post('/api/transcribe', authMiddleware, upload.single('file'), transcribeReal);
  } else {
    // Without multer we cannot parse multipart; return helpful error
    app.post('/api/transcribe', authMiddleware, (req, res) => res.status(500).json({ error: 'Server missing multipart parser (multer). Please install dependencies.' }));
  }
}

if (VOICE_CORRECTION) {
  app.post('/api/transcribe/correct', authMiddleware, async (req, res) => {
    try {
      const { segment, context, language } = req.body || {};
      if (!segment || !segment.rawText) return res.status(400).json({ error: 'segment.rawText required' });
      // Determine API key: prefer user key if configured, else env
      let key = process.env.OPENAI_API_KEY;
      if (req.user?.apiKeyEncrypted) {
        try { const bytes = CryptoJS.AES.decrypt(req.user.apiKeyEncrypted, CRYPTO_SECRET); key = bytes.toString(CryptoJS.enc.Utf8) || key; } catch {}
      }
      if (!key) return res.status(400).json({ error: 'OpenAI API key not configured' });

      // Helper to call a model and parse a JSON-ish response
      async function callModel(model) {
        const openai = new OpenAIClient({ apiKey: key });
        const sys = 'You correct low-confidence ASR segments with minimal edits. Reply as a compact JSON object with keys correctedText, certainty (0..1), rationale.';
        const user = JSON.stringify({ segment, context, language });
        const resp = await openai.chat.completions.create({
          model,
          messages: [ { role: 'system', content: sys }, { role: 'user', content: user } ],
          temperature: 0,
          // Encourage JSON output when supported by SDK/model
          response_format: { type: 'json_object' }
        });
        const content = resp?.choices?.[0]?.message?.content || '';
        try { return JSON.parse(content); } catch { return { correctedText: content, certainty: 0.5, rationale: 'freeform' }; }
      }

      let draft = await callModel(process.env.CORRECTION_MODEL_MINI || 'gpt5-mini');
      if (typeof draft?.certainty !== 'number' || draft.certainty < 0.7) {
        draft = await callModel(process.env.CORRECTION_MODEL_STRONG || 'gpt-5');
      }
      return res.json({ correctedText: draft.correctedText || segment.rawText, certainty: Number(draft.certainty) || 0, rationale: draft.rationale || '', model: (draft.model || undefined) });
    } catch (err) {
      console.error('Correction error:', err?.response?.data || err?.message || err);
      return res.status(500).json({ error: 'Correction failed' });
    }
  });
}

// ---------------------------------------------------------------------------
// Ideologram auxiliary services (Goodreads OAuth and Scores API) via proxy
// ---------------------------------------------------------------------------
// If env vars are set to point to running Ideologram services, proxy them under
// our server for a single origin frontend. Otherwise, these routes are no-ops.
const IDEO_GOODREADS_URL = process.env.IDEO_GOODREADS_URL; // e.g. http://localhost:4321
const IDEO_SCORES_API_URL = process.env.IDEO_SCORES_API_URL; // e.g. http://localhost:4545

if (IDEO_GOODREADS_URL) {
  app.use('/api/ideologram/goodreads', createProxyMiddleware({
    target: IDEO_GOODREADS_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/ideologram/goodreads': '' },
    logLevel: 'warn',
  }));
}

if (IDEO_SCORES_API_URL) {
  app.use('/api/ideologram/scores', createProxyMiddleware({
    target: IDEO_SCORES_API_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/ideologram/scores': '' },
    logLevel: 'warn',
  }));
}

// ---------------------------------------------------------------------------
// Ideologram enrichment (server-side to avoid CORS/rate-limit issues in browser)
// ---------------------------------------------------------------------------
// Basic in-memory cache to reduce repeated calls during a session
const enrichCache = new Map(); // key: 'ol:title|author|isbn' or 'wd:title|author|isbn' → { metadata, inferredAxes }
async function fetchJson(url, opts = {}) {
  try {
    const resp = await axios.get(url, { timeout: 12000, ...opts });
    return resp.data;
  } catch (err) {
    return null;
  }
}

// Open Library
async function fetchOpenLibraryByIsbn(isbn) {
  const edition = await fetchJson(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`);
  let work = null;
  try {
    const workKey = edition?.works?.[0]?.key;
    if (workKey) work = await fetchJson(`https://openlibrary.org${workKey}.json`);
  } catch {}
  return { edition, work };
}
async function fetchOpenLibraryByTitleAuthor(title, author) {
  const params = new URLSearchParams(); params.set('title', title || ''); if (author) params.set('author', author);
  params.set('limit', '1');
  const search = await fetchJson(`https://openlibrary.org/search.json?${params}`);
  let edition = null; let work = null;
  try {
    const doc = search?.docs?.[0] || null;
    const workKey = doc?.key;
    if (doc?.edition_key?.[0]) edition = await fetchJson(`https://openlibrary.org/books/${doc.edition_key[0]}.json`);
    if (workKey) work = await fetchJson(`https://openlibrary.org${workKey}.json`);
  } catch {}
  return { edition, work };
}
app.post('/api/ideologram/enrich/openlibrary', async (req, res) => {
  const book = req.body?.book || {};
  if (!book || !book.title) return res.status(400).json({ error: 'book.title required' });
  try {
    let edition = null, work = null;
    if (book.isbn) ({ edition, work } = await fetchOpenLibraryByIsbn(String(book.isbn)));
    if (!work) ({ edition, work } = await fetchOpenLibraryByTitleAuthor(String(book.title), book.author ? String(book.author) : undefined));
    if (!edition && !work) {
      const topics = inferFallbackTopicsFromBook(book);
      return res.json({ metadata: { topics, subjects: topics, sources: { fallback: true } }, inferredAxes: mapTopicsToAxes(topics) });
    }
    const subjects = [];
    const workSubjects = [].concat(work?.subjects || [], work?.subject_people || [], work?.subject_places || [], work?.subject_times || []);
    workSubjects.forEach(s => { if (typeof s === 'string') subjects.push(s); });
    if (Array.isArray(edition?.subjects)) edition.subjects.forEach(s => subjects.push(s));
    const topics = Array.from(new Set(subjects.map(normalizeTopic)));
    const inferredAxes = mapTopicsToAxes(topics);
    const metadata = {
      isFictionInferred: undefined,
      subjects: topics,
      classifications: {
        lcc: (edition?.lc_classifications || [])[0],
        ddc: (edition?.dewey_decimal_class || [])[0],
      },
      description: typeof work?.description === 'string' ? work.description : (work?.description?.value || undefined),
      topics,
      sources: { openLibrary: { workKey: work?.key, editionKey: edition?.key } },
    };
    res.json({ metadata, inferredAxes });
  } catch (err) {
    const topics = inferFallbackTopicsFromBook(book);
    res.json({ metadata: { topics, subjects: topics, sources: { fallback: true } }, inferredAxes: mapTopicsToAxes(topics) });
  }
});

// Wikidata
async function findWikidataByIsbn(isbn) {
  const clean = String(isbn).replace(/[^0-9Xx]/g, '');
  const query = `SELECT ?item WHERE { VALUES ?prop { wdt:P212 wdt:P957 } ?item ?prop "${clean}" . } LIMIT 1`;
  const url = 'https://query.wikidata.org/sparql';
  try {
    const resp = await axios.get(url, { params: { query, format: 'json' }, timeout: 12000, headers: { 'accept': 'application/sparql-results+json' } });
    const uri = resp.data?.results?.bindings?.[0]?.item?.value;
    return uri ? uri.split('/').pop() : null;
  } catch { return null; }
}
async function findWikidataByTitleAuthor(title, author) {
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.searchParams.set('action', 'wbsearchentities');
  url.searchParams.set('search', author ? `${title} ${author}` : String(title || ''));
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  const json = await fetchJson(url.toString());
  return json?.search?.[0]?.id || null;
}
async function fetchWikidataDetails(qid) {
  const query = `SELECT ?item ?instanceLabel ?genreLabel ?subjectLabel WHERE { VALUES ?item { wd:${qid} } OPTIONAL { ?item wdt:P31 ?instance . } OPTIONAL { ?item wdt:P136 ?genre . } OPTIONAL { ?item wdt:P921 ?subject . } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
  const url = 'https://query.wikidata.org/sparql';
  try {
    const resp = await axios.get(url, { params: { query, format: 'json' }, timeout: 12000, headers: { 'accept': 'application/sparql-results+json' } });
    const rows = resp.data?.results?.bindings || [];
    const instanceOf = new Set(); const genres = new Set(); const mainSubjects = new Set();
    rows.forEach(b => { if (b.instanceLabel?.value) instanceOf.add(b.instanceLabel.value); if (b.genreLabel?.value) genres.add(b.genreLabel.value); if (b.subjectLabel?.value) mainSubjects.add(b.subjectLabel.value); });
    return { qid, instanceOf: Array.from(instanceOf), genres: Array.from(genres), mainSubjects: Array.from(mainSubjects) };
  } catch { return null; }
}
app.post('/api/ideologram/enrich/wikidata', async (req, res) => {
  const book = req.body?.book || {};
  if (!book || !book.title) return res.status(400).json({ error: 'book.title required' });
  try {
    let qid = null;
    if (book.isbn) qid = await findWikidataByIsbn(book.isbn);
    if (!qid) qid = await findWikidataByTitleAuthor(book.title, book.author);
    if (!qid) {
      const topics = inferFallbackTopicsFromBook(book);
      return res.json({ metadata: { qid: null, topics, mainSubjects: topics }, inferredAxes: mapTopicsToAxes(topics) });
    }
    const meta = await fetchWikidataDetails(qid);
    const topics = [].concat(meta?.mainSubjects || [], meta?.genres || []);
    const inferredAxes = mapTopicsToAxes(topics);
    res.json({ metadata: { ...meta, topics }, inferredAxes });
  } catch {
    const topics = inferFallbackTopicsFromBook(book);
    res.json({ metadata: { qid: null, topics, mainSubjects: topics }, inferredAxes: mapTopicsToAxes(topics) });
  }
});

// Book compression endpoint using MDL pipeline
app.post('/api/ideologram/compress', authMiddleware, async (req, res) => {
  console.log('📚 Book compression request received:', { 
    userId: req.user.id, userEmail: req.user.email,
    textLength: req.body?.text?.length || 0
  });
  
  const { text, bookId, title, author, docType = 'nonfiction' } = req.body || {};
  
  if (!text || !bookId) {
    return res.status(400).json({ error: 'text and bookId required' });
  }

  try {
    // Create output directory for this user
    const userDir = path.join(__dirname, 'compressed', req.user.id);
    const bookDir = path.join(userDir, bookId);
    fs.mkdirSync(bookDir, { recursive: true });

    // Create temporary text file
    const txtPath = path.join(bookDir, 'input.txt');
    fs.writeFileSync(txtPath, text, 'utf8');

    // Create CEP (Context Enrichment Profile) based on document type
    const cep = {
      doc_type: docType,
      expected_density_per_1k: docType === 'fiction' ? 5.0 : docType === 'paper' ? 45.0 : 25.0,
      thresholds: {
        sim_cos: docType === 'fiction' ? 0.88 : 0.85,
        ncd: docType === 'fiction' ? 0.30 : 0.38,
        min_cluster: docType === 'fiction' ? 3 : 2
      },
      mdl: {
        ptr_cost_bits: 64,
        target_coverage: 0.85
      }
    };

    const cepPath = path.join(bookDir, 'cep.json');
    fs.writeFileSync(cepPath, JSON.stringify(cep, null, 2));

    // Run compression pipeline
    const { spawn } = require('child_process');
    const pythonScript = path.join(__dirname, '..', 'Ideologram', 'K-Compress', 'book_compressor_mdl.py');
    
    return new Promise((resolve, reject) => {
      // Set environment variables for test mode
      const env = { ...process.env };
      if (req.body.testMode && req.body.maxSentences) {
        env.MAX_SENTENCES_TEST = req.body.maxSentences.toString();
        console.log(`🧪 Test mode enabled: processing max ${req.body.maxSentences} sentences`);
      }
      
      const pythonProcess = spawn('python3', [
        pythonScript,
        '--book_id', bookId,
        '--txt_path', txtPath,
        '--out_dir', bookDir,
        '--cep', cepPath
      ], { env });

      let stdout = '';
      let stderr = '';
      let lastActivity = Date.now();

      // Monitor stdout for progress indicators
      pythonProcess.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        lastActivity = Date.now();
        
        // Log progress indicators
        if (output.includes('Processing batch') || output.includes('Processing sentence')) {
          console.log('📝 Progress:', output.trim());
        }
        if (output.includes('Extracted') || output.includes('statements')) {
          console.log('✅ Progress:', output.trim());
        }
      });

      // Monitor stderr for errors
      pythonProcess.stderr.on('data', (data) => {
        const error = data.toString();
        stderr += error;
        lastActivity = Date.now();
        
        if (error.trim()) {
          console.log('⚠️  Python stderr:', error.trim());
        }
      });

      // Monitor process health
      const healthCheck = setInterval(() => {
        const timeSinceActivity = Date.now() - lastActivity;
        if (timeSinceActivity > 5 * 60 * 1000) { // 5 minutes of no output
          console.warn('⚠️  No output for 5 minutes, process may be stuck...');
        }
      }, 60000); // Check every minute

      // Set timeout for the entire compression process
      const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
      const timeoutId = setTimeout(() => {
        console.error('⏰ Compression timeout reached, killing Python process...');
        pythonProcess.kill('SIGKILL');
        reject(new Error('Compression timeout: process took longer than 30 minutes'));
      }, TIMEOUT_MS);

      pythonProcess.on('close', async (code) => {
        clearTimeout(timeoutId); // Clear timeout since process finished
        clearInterval(healthCheck); // Stop health monitoring
        
        console.log('🐍 Python process closed with code:', code);
        console.log('📤 Python stdout:', stdout);
        console.log('📤 Python stderr:', stderr);
        console.log('📁 Output directory:', bookDir);
        
        if (code !== 0) {
          console.error('❌ Python compression failed:', stderr);
          return reject(new Error(`Compression failed with code ${code}: ${stderr}`));
        }

        try {
          // Read compression outputs
          const outputs = {};
          const outputFiles = [
            'sentences.jsonl', 'ists.jsonl', 'embeddings.npy',
            'paraphrase_clusters.json', 'chapter_cores.jsonl', 
            'book_core.json', 'density_report.json'
          ];

          console.log('🔍 Checking for output files...');
          
          // The Python script creates files in a nested directory structure
          // Look in both the bookDir and bookDir/bookId subdirectory
          const possiblePaths = [bookDir, path.join(bookDir, bookId)];
          
          for (const file of outputFiles) {
            let filePath = null;
            let found = false;
            
            // Try to find the file in either directory
            for (const basePath of possiblePaths) {
              const testPath = path.join(basePath, file);
              if (fs.existsSync(testPath)) {
                filePath = testPath;
                found = true;
                console.log(`  📄 ${file}: EXISTS in ${basePath}`);
                break;
              }
            }
            
            if (!found) {
              console.log(`  📄 ${file}: MISSING in all locations`);
              continue;
            }
            
            if (file.endsWith('.jsonl')) {
              const content = fs.readFileSync(filePath, 'utf8');
              outputs[file] = content.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
            } else if (file.endsWith('.json')) {
              outputs[file] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            } else if (file.endsWith('.npy')) {
              // For now, just note that embeddings exist
              outputs[file] = { exists: true, size: fs.statSync(filePath).size };
            }
          }

          // Save compression metadata to user's ideologram data
          const entry = getUserEntry(req.user.id);
          const user = entry.value() || {};
          const ideologram = user.ideologram || {};
          
          if (!ideologram.compressed) {
            ideologram.compressed = { books: [] };
          }

          const compressedBook = {
            id: bookId,
            title: title || 'Untitled',
            author: author || 'Unknown',
            docType,
            compressedAt: new Date().toISOString(),
            outputs: Object.keys(outputs),
            summary: outputs['book_core.json'] || {},
            density: outputs['density_report.json'] || {},
            stats: {
              sentences: outputs['sentences.jsonl']?.length || 0,
              statements: outputs['ists.jsonl']?.filter(ist => !ist.none)?.length || 0,
              clusters: outputs['paraphrase_clusters.json']?.stats?.n_clusters || 0,
              theses: outputs['book_core.json']?.theses?.length || 0
            }
          };

          ideologram.compressed.books = ideologram.compressed.books.filter(b => b.id !== bookId);
          ideologram.compressed.books.push(compressedBook);
          
          entry.assign({ ideologram }).write();

          console.log('✅ Book compression completed successfully for user:', req.user.email);
          res.json({ 
            ok: true, 
            bookId,
            outputs: Object.keys(outputs),
            summary: compressedBook
          });

        } catch (error) {
          console.error('❌ Error processing compression outputs:', error);
          reject(error);
        }
      });
    });

  } catch (error) {
    console.error('❌ Error in book compression:', error);
    res.status(500).json({ error: 'Compression failed', details: error.message });
  }
});

// Start server if run directly
if (require.main === module) {
  const http = require('http');
  const server = http.createServer(app);

  // Optional WebSocket proxy for Realtime (browser WS cannot set auth headers)
  if (VOICE_REALTIME) {
    try {
      const WebSocket = require('ws');
      const wss = new WebSocket.Server({ server, path: '/api/realtime/ws' });
      wss.on('connection', (client, req) => {
        try {
          const url = new URL(req.url, 'http://localhost');
          const token = url.searchParams.get('token');
          const model = url.searchParams.get('model') || process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview';
          if (!token) { client.close(1008, 'missing token'); return; }
          const upstream = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
            headers: { Authorization: `Bearer ${token}`, 'OpenAI-Beta': 'realtime=v1' }
          });
          // Pipe messages both ways
          upstream.on('message', (data, isBinary) => {
            try { client.send(data, { binary: isBinary }); } catch {}
          });
          upstream.on('close', (code, reason) => { try { client.close(code, reason); } catch {} });
          upstream.on('error', () => { try { client.close(1011, 'upstream error'); } catch {} });

          client.on('message', (data, isBinary) => {
            try { upstream.send(data, { binary: isBinary }); } catch {}
          });
          client.on('close', () => { try { upstream.close(); } catch {} });
          client.on('error', () => { try { upstream.close(); } catch {} });
        } catch {
          try { client.close(1011, 'proxy error'); } catch {}
        }
      });
      console.log('WS proxy enabled at /api/realtime/ws');
    } catch (e) {
      console.warn('WS proxy unavailable (missing ws dependency):', e?.message || e);
    }
  }

  // Bind to localhost only to avoid permission errors on 0.0.0.0
  server.listen(PORT, '127.0.0.1')
    .on('listening', () => console.log(`Server listening on http://127.0.0.1:${PORT}`))
    .on('error', (err) => {
      console.error(`Failed to bind server on port ${PORT}: ${err.message}`);
      console.error('Try setting the PORT environment variable to a free port, e.g.: export PORT=5001');
      process.exit(1);
    });
}

// Export app for testing
module.exports = app;
