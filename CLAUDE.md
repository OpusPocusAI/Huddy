# CLAUDE.md - Comprehensive Development Guide

## Table of Contents
1. [Project Overview](#project-overview)
2. [Build & Development Commands](#build--development-commands)
3. [Technology Stack](#technology-stack)
4. [Project Architecture](#project-architecture)
5. [Recent Issues & Fixes](#recent-issues--fixes)
6. [Key Features](#key-features)
7. [Data Structures & APIs](#data-structures--apis)
8. [Code Style Guidelines](#code-style-guidelines)
9. [Deployment](#deployment)

---

## Project Overview

**Huddy** is a sophisticated 3D globe visualization platform that combines:
- Interactive data visualization on a WebGL globe
- AI-powered chat interface with natural language dataset queries
- Multiple data sources (World Bank, OWID, Financial APIs)
- Multi-feature architecture including Ideologram, Voice/Avatar systems
- Real-time data exploration and graph generation

### Core Purpose
Enable users to explore global datasets through conversational AI and interactive 3D visualizations. The AI can understand natural language requests like "show me GDP data" and automatically visualize them on the globe.

---

## Build & Development Commands

```bash
# Development (runs both frontend and backend)
npm run dev              # Starts Express (5999) + React dev server (3000)

# Individual services
npm start                # Frontend dev server only (port 3000)
npm run start-server     # Backend Express server only (port 5999)

# Production
npm run build            # Create optimized production build
npx serve -s build       # Serve production build locally
```

---

## Technology Stack

### Frontend
- **React 18.3.1** - Modern hooks-based architecture with createRoot API
- **React Router 6** - Client-side routing
- **Three.js & three-globe** - WebGL 3D globe rendering
- **D3.js** - Data visualization and color scales
- **TailwindCSS** - Utility-first styling
- **Framer Motion** - Animations
- **Chart.js** - 2D graphing

### Backend
- **Express.js** - REST API server (port 5999)
- **OpenAI API** - GPT-4o-mini with function calling
- **LowDB** - JSON file-based database
- **Axios** - HTTP client for external APIs
- **JWT** - Authentication tokens

### Data Sources
- **World Bank API v2** - Primary data source (working ✓)
- **Our World in Data (OWID)** - Currently broken (all endpoints return 404)
- **Financial Modeling Prep** - Financial data
- **OpenLibrary & Wikidata** - Additional datasets

---

## Project Architecture

### Directory Structure
```
/src
├── components/              # Legacy React components
│   ├── ReactGlobeExample.jsx  # Main app orchestrator (CRITICAL)
│   ├── Globe.jsx            # 3D globe wrapper
│   ├── GraphComponent.jsx   # Chart.js graphs
│   └── Effects/             # Visual effects
├── features/                # Modular feature-based architecture
│   ├── chat/                # AI chat system
│   ├── datasets/            # Dataset management
│   │   └── DatasetSearchPanel.jsx  # World Bank search UI
│   ├── globe/               # Globe controls and rendering
│   ├── ideologram/          # Ideologram feature suite
│   ├── ui/                  # UI components (sidebars, panels)
│   ├── voice/               # Voice/realtime/transcription
│   │   ├── index.js         # Voice API
│   │   ├── realtimeClient.js  # OpenAI Realtime WebSocket
│   │   └── lipsync.js       # Lip-sync driver for avatars
│   └── avatar/              # 3D avatar integration
├── contexts/                # React Context providers
│   ├── AuthContext.js       # Authentication (ACTIVE)
│   ├── DatasetProvider.jsx  # Dataset state
│   ├── LayoutProvider.jsx   # Layout/view modes
│   └── ThemeProvider.jsx    # Theming
├── services/                # API clients
│   ├── authClient.js        # Auth API wrapper
│   ├── worldBankApi.js      # World Bank client (WORKING)
│   └── openaiClient.js      # OpenAI client
├── utils/                   # Utilities
│   ├── loadDataset.js       # Dataset loading
│   └── api.js               # Axios instance
└── pages/                   # Route components
    ├── Login.jsx
    ├── Settings.jsx
    └── IdeologramPage.jsx

/server
└── index.js                 # Express server with OpenAI function calling
```

### Key Architectural Patterns

**1. Feature-Based Organization**
The codebase uses a modular feature architecture with 12 primary domains:
- Chat, Datasets, Globe, Ideologram, UI, Voice, Avatar, Settings, Navigation, Effects, Providers, Services

**2. Event-Driven Communication**
- `src/shared/events/eventBus.js` - Central event bus for cross-feature communication
- Voice/Avatar systems emit events that UI components consume

**3. Context-Based State Management**
Multiple React contexts provide global state without Redux:
- AuthContext - User authentication
- DatasetProvider - Dataset catalog and selection
- LayoutProvider - View modes (home/chat/settings)
- ThemeProvider - Dark/light themes

---

## Recent Issues & Fixes

### Session Context: Mobile Refactor Breakage
A large refactor on the `mobile-optimized-refactor` branch broke several core features. This session focused on identifying and fixing these issues.

### Issue #1: Dataset Search Non-Functional ✓ FIXED
**Problem:** Typing in Dataset Search panel did nothing. World Bank integration was broken.

**Root Cause:**
- `handleSearch()` and `handleProcessDataset()` in ReactGlobeExample.jsx were empty callback stubs
- World Bank API imports were commented out

**Fix (commit 8b28b7d):**
```javascript
// Restored in ReactGlobeExample.jsx lines 334-349
import { getCountries, getIndicators } from '../services/worldBankApi';

const handleSearch = useCallback(async () => {
  const q = datasetQuery.trim();
  if (!q) return;
  const inds = await getIndicators(q);
  if (inds.length > 0) {
    setDatasetSearchResults(inds.slice(0, 10));
  } else {
    const countriesRes = await getCountries(q);
    setCountryList(countriesRes);
  }
}, [datasetQuery]);
```

**Location:** `/src/components/ReactGlobeExample.jsx:334-349`

---

### Issue #2: AI Chat → Globe Control Broken ✓ FIXED
**Problem:** AI chat used to control the globe (e.g., "show me GDP data" would visualize it), but this functionality was lost.

**Root Cause:**
- Frontend was calling OpenAI directly via `openaiClient.js`
- Should have been calling backend `/api/chat` endpoint
- Backend has OpenAI function-calling tools: `show_dataset`, `plot_dataset`, etc.
- Backend returns special directives: `__GLOBE__` and `__PLOT__`

**Fix (commit 0d0e597):**
Restored chat handlers in ReactGlobeExample.jsx:

```javascript
// Lines 237-325
const handleChatSend = useCallback(async (content) => {
  // Call backend /api/chat with conversation history
  const response = await API.post('/api/chat', {
    prompt: content,
    conversationId: convId,
    model: 'gpt-4o-mini'
  });

  // Parse AI response for directives
  const aiContent = response.data.reply || '';

  if (aiContent.startsWith('__GLOBE__')) {
    const jsonStr = aiContent.replace('__GLOBE__', '');
    const directive = JSON.parse(jsonStr);
    handleDatasetSelect(directive.id, 'globe');
  } else if (aiContent.startsWith('__PLOT__')) {
    const jsonStr = aiContent.replace('__PLOT__', '');
    const directive = JSON.parse(jsonStr);
    handleDatasetSelect(directive.id, 'graph');
  }

  // Update conversation history
  setCurrentConversation(prev => [
    ...prev,
    { sender: 'user', text: content, timestamp },
    { sender: 'assistant', text: aiContent, timestamp }
  ]);
}, [currentConvId, handleDatasetSelect]);
```

**Backend Architecture:**
- Server: `/server/index.js:1070-1336`
- OpenAI function-calling with 5 tools:
  1. `list_datasets` - List all available datasets
  2. `show_dataset` - Show dataset on globe → returns `__GLOBE__{...}`
  3. `plot_dataset` - Plot as graph → returns `__PLOT__{...}`
  4. `define_dataset` - Create new dataset definition
  5. ~~`search_knowledge_base`~~ - Disabled (OWID broken)

---

### Issue #3: AI Not Adaptive to New Datasets ✓ FIXED
**Problem:** AI could only visualize pre-configured datasets, not discover new ones.

**Fix (commit 6e3d1e2):**
Enhanced backend with:

1. **Dynamic System Prompt** (lines 1100-1122):
```javascript
const availableDatasets = STATIC_DATASETS.concat(db.get('datasets').value() || []);
const datasetList = availableDatasets.map(d => `- ${d.id}: ${d.title}`).join('\n');

const systemMessage = {
  role: 'system',
  content: `You are a data visualization assistant for a 3D globe application.

Available datasets:
${datasetList}

Your capabilities:
1. List available datasets using list_datasets
2. Show datasets on the 3D globe using show_dataset
3. Plot datasets as graphs using plot_dataset
4. Create new dataset definitions using define_dataset

When a user asks for data:
- If you recognize it in available datasets, use show_dataset or plot_dataset
- If not in list, inform user they can search World Bank via Dataset Search panel
- Be proactive: offer to visualize relevant datasets when topics are mentioned`
};
```

2. **list_datasets Tool** - AI can query available datasets
3. **define_dataset Tool** - AI can create new dataset definitions
4. Instructions for discovering and adding datasets dynamically

---

### Issue #4: OWID Integration Completely Broken ✓ FIXED
**Problem:** User reported OWID not working. Need to test before routing to it.

**Investigation:**
Tested all OWID endpoints (commit e6473e2):
```bash
# All return 404 or DNS failure
curl https://owlbot.owid.cloud/api/v1/search?q=gdp          # DNS failure
curl https://catalog.ourworldindata.org/datapackage.json    # 404
curl https://api.github.com/repos/owid/owid-datasets/...    # 404
```

**Fix (commit e6473e2):**
1. Removed `search_knowledge_base` tool from function calling
2. Updated system prompt to remove OWID references
3. Directed users to World Bank Dataset Search as primary source
4. OWID search function still exists but gracefully fails

**Code Changes:**
- `/server/index.js:1225-1230` - Removed searchTool from functions array
- `/server/index.js:1110-1121` - Updated system prompt
- `/server/index.js:253-293` - owidSearch() still present but unused

---

### Issue #5: Runtime Error "Cannot access 'Ht' before initialization" ✓ FIXED
**Problem:** Vercel deployment failed with initialization error in production build.

**Root Cause Analysis:**
1. **Duplicate AuthProvider Files:**
   - `/src/contexts/AuthProvider.jsx` - Unused, default export
   - `/src/contexts/AuthContext.js` - Active, named export
   - Webpack was picking up both, creating circular dependency

2. **Outdated React API:**
   - Using deprecated `ReactDOM.render` with React 18.3.1
   - Should use `ReactDOM.createRoot`

**Fix (commits 76b8688, b857330, a1be450):**

**Step 1:** Removed unused AuthProvider.jsx (commit 76b8688)
```bash
git rm src/contexts/AuthProvider.jsx
```

**Step 2:** Updated to React 18 API (commit b857330)
```javascript
// src/index.js
import ReactDOM from 'react-dom/client';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
```

**Step 3:** Removed duplicate wrapper (commit a1be450)
- index.js no longer wraps with AuthProvider
- App.js provides AuthProvider from AuthContext.js
- Single source of truth for authentication context

**Build Verification:**
```bash
npm run build
# ✓ Compiled successfully
# Main bundle: 675.63 kB (gzipped)
```

---

## Key Features

### 1. 3D Globe Visualization
**Location:** `/src/components/Globe.jsx`, `/src/features/globe/`

**Capabilities:**
- WebGL-based interactive 3D globe using three-globe
- Country polygons colored by data values (D3 color scales)
- Hover tooltips showing country name + data value
- Animated year slider for time-series data
- Point clouds, arcs, and hex grids for various data types

**Key Props:**
```javascript
<Globe
  globeData={geoData}           // Country polygons
  globeDataValue={(d) => value} // Color mapping
  pointsData={points}           // Point cloud data
  labelsData={labels}           // Text labels
  hexBinPointsData={hexData}    // Hex grid
/>
```

### 2. AI Chat with Function Calling
**Location:** `/src/features/chat/`, `/server/index.js:1070-1336`

**How It Works:**
1. User sends message via chat UI
2. Frontend calls `/api/chat` with conversation history
3. Backend constructs OpenAI request with system prompt + available datasets
4. AI decides which function to call:
   - `list_datasets` → returns dataset catalog
   - `show_dataset` → returns `__GLOBE__{id: "population"}`
   - `plot_dataset` → returns `__PLOT__{id: "gdp", defaultRegion: "USA"}`
   - `define_dataset` → saves new dataset to db.json
5. Frontend parses directives and triggers visualization

**Example Flow:**
```
User: "Show me global population data"
  ↓
Backend → OpenAI (system: available datasets, tools: [show_dataset, ...])
  ↓
OpenAI function_call: { name: "show_dataset", arguments: {id: "population"} }
  ↓
Backend: reply = "__GLOBE__" + JSON.stringify({id: "population"})
  ↓
Frontend: Parse __GLOBE__, call handleDatasetSelect("population", "globe")
  ↓
Globe updates with population data
```

### 3. Dataset Search (World Bank)
**Location:** `/src/features/datasets/DatasetSearchPanel.jsx`, `/src/services/worldBankApi.js`

**World Bank API Integration:**
```javascript
// Base URL: https://api.worldbank.org/v2
// Format: JSON with pagination

// Search indicators (e.g., "GDP", "education")
GET /v2/indicator?format=json&per_page=1000

// Search countries/regions
GET /v2/country?format=json&per_page=1000

// Get indicator data for all countries
GET /v2/country/all/indicators/{indicator}?format=json&per_page=20000&date=1960:2024
```

**User Flow:**
1. Type search query (e.g., "GDP")
2. Click "Go" → calls `handleSearch()`
3. Searches indicators first, then countries if no match
4. Display results in panel
5. Click result → calls `handleProcessDataset()`
6. Maps indicator to internal dataset format
7. Loads data and visualizes on globe

### 4. Ideologram
**Location:** `/src/features/ideologram/`, `/src/pages/IdeologramPage.jsx`

**Purpose:** CSV library management with AI enrichment and scoring

**Features:**
- Upload and manage CSV datasets
- AI-powered data enrichment
- Scoring/assessment system
- Chat history for dataset queries
- User-specific localStorage isolation

**Storage Keys:**
```javascript
'ideologram:library'         // Uploaded CSVs
'ideologram:enriched'        // AI-enriched data
'ideologram:scores:v1'       // Dataset scores
'ideologram:assessments'     // Assessments
'ideologram:chat-history'    // Chat logs
```

### 5. Voice & Avatar System
**Location:** `/src/features/voice/`, `/src/features/avatar/`

**Components:**
- **Realtime Voice** - OpenAI Realtime API via WebSocket
- **Transcription** - Upload audio for transcription
- **Lip Sync** - Audio-driven viseme generation (RMS + zero-crossing)
- **3D Avatar** - Ready Player Me integration
- **VAD** - Voice Activity Detection for turn-taking

**Lip Sync Algorithm:**
```javascript
// src/features/voice/lipsync.js
// Computes 3 viseme values from PCM audio:
// - JawOpen: RMS energy (volume)
// - MouthPucker: Zero-crossing rate (high freq)
// - MouthWide: Inverse of pucker
```

**Event Bus Integration:**
```javascript
import eventBus from '../../shared/events/eventBus';

eventBus.emit(Events.VoiceRealtimeConnected, { session });
eventBus.emit(Events.VoiceAvatarViseme, { tSec, shapes });
```

### 6. Authentication
**Location:** `/src/contexts/AuthContext.js`, `/server/index.js:500-700`

**Authentication Methods:**
1. **Email/Password** - Local signup/login
2. **Google OAuth** - Popup flow with postMessage
3. **GitHub OAuth** - Popup flow with postMessage

**Flow:**
```javascript
// Client-side
const { continueWithEmail, continueWithGoogle } = useAuth();

// Email login
await continueWithEmail(email, password);
// 1. POST /api/auth/check-email
// 2. If exists → POST /api/auth/login, else POST /api/auth/signup
// 3. Receive JWT token
// 4. Store in localStorage
// 5. Update user context

// OAuth login
const user = await continueWithGoogle();
// 1. Open popup → /api/auth/google
// 2. Backend redirects to Google
// 3. Google redirects back to backend with code
// 4. Backend exchanges code for token
// 5. Backend sends postMessage with JWT
// 6. Frontend receives message, stores token
```

**Protected Routes:**
```javascript
<Route
  path="/settings"
  element={
    <ProtectedRoute>
      <Settings />
    </ProtectedRoute>
  }
/>
```

---

## Data Structures & APIs

### Dataset Format
```javascript
{
  id: "population",                    // Unique identifier
  title: "World Population",           // Display name
  description: "Historical population data",
  type: "time-series",                 // Dataset type
  supportedViews: ["graph", "globe"],  // Where it can be shown
  url: "https://..."                   // CSV source (optional)
}
```

### Dataset Item Format
```javascript
{
  entity: "United States",  // Country/region name
  code: "USA",              // ISO code (optional)
  year: 2020,               // Year
  value: 331449281,         // Numeric value
  metric: "Population"      // What's being measured
}
```

### Static Datasets
Defined in `/server/index.js:324-329`:
```javascript
const STATIC_DATASETS = [
  { id: 'population', title: 'World Population', ... },
  { id: 'life-expectancy', title: 'Life Expectancy', ... },
  { id: 'NY.GDP.PCAP.PP.KD', title: 'GDP per Capita (PPP)', ... }
];
```

### World Bank API Response
```javascript
[
  { page: 1, pages: 10, per_page: 50, total: 500 },
  [
    {
      indicator: { id: "NY.GDP.MKTP.CD", value: "GDP (current US$)" },
      country: { id: "US", value: "United States" },
      value: "21433225.19",
      date: "2019"
    }
  ]
]
```

### AI Function Calling Structure
```javascript
// OpenAI request
{
  model: "gpt-4o-mini",
  messages: [...conversationHistory],
  functions: [
    {
      name: "show_dataset",
      description: "Show dataset on 3D globe",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Dataset identifier" }
        },
        required: ["id"]
      }
    }
  ],
  function_call: "auto"
}

// OpenAI response
{
  choices: [{
    message: {
      function_call: {
        name: "show_dataset",
        arguments: '{"id":"population"}'
      }
    }
  }]
}

// Backend processes and returns
{
  reply: "__GLOBE__{\"id\":\"population\"}",
  conversationId: "123456789",
  createdAt: "2024-01-01T00:00:00.000Z"
}
```

---

## Code Style Guidelines

### React Components
```javascript
// Use functional components with hooks
import React, { useState, useEffect, useCallback, useMemo } from 'react';

function MyComponent({ prop1, prop2 }) {
  const [state, setState] = useState(initialValue);

  const memoizedValue = useMemo(() => expensiveCalc(), [deps]);

  const handleClick = useCallback(() => {
    // Handler logic
  }, [deps]);

  useEffect(() => {
    // Side effects
    return () => {
      // Cleanup
    };
  }, [deps]);

  return <div>...</div>;
}

export default MyComponent;
```

### File Naming
- **Components:** PascalCase with .jsx extension (`DatasetPanel.jsx`)
- **Utilities:** camelCase with .js extension (`loadDataset.js`)
- **Contexts:** PascalCase with Provider suffix (`AuthContext.js`)
- **Services:** camelCase with Client/Api suffix (`worldBankApi.js`)

### State Management
```javascript
// Local state for component-specific data
const [localData, setLocalData] = useState(null);

// Context for cross-component state
const { user, login, logout } = useAuth();

// useRef for DOM references and non-reactive values
const globeRef = useRef();
const isMountedRef = useRef(true);
```

### API Calls
```javascript
// Use try-catch with async/await
const fetchData = async () => {
  try {
    const response = await API.get('/api/endpoint');
    setData(response.data);
  } catch (error) {
    console.error('Fetch failed:', error);
    setError(error.message);
  }
};

// Clean up in useEffect
useEffect(() => {
  const controller = new AbortController();

  fetch(url, { signal: controller.signal })
    .then(...)
    .catch(...);

  return () => controller.abort();
}, [url]);
```

### Performance Optimization
```javascript
// Memoize expensive calculations
const processedData = useMemo(() => {
  return data.map(item => heavyTransform(item));
}, [data]);

// Throttle/debounce user input
import { debounce } from 'lodash';

const debouncedSearch = useMemo(
  () => debounce((query) => performSearch(query), 300),
  []
);
```

---

## Deployment

### Environment Variables

**Development (.env):**
```bash
DANGEROUSLY_DISABLE_HOST_CHECK=true
REACT_APP_API_URL=http://127.0.0.1:5999
REACT_APP_SERVER_ROOT_URL=http://127.0.0.1:5999
```

**Production (Vercel):**
```bash
REACT_APP_API_URL=https://your-backend.vercel.app
REACT_APP_SERVER_ROOT_URL=https://your-backend.vercel.app
OPENAI_API_KEY=sk-...
JWT_SECRET=your-secret-key
CRYPTO_SECRET=your-encryption-key
```

### Build Process
```bash
# 1. Clean build
rm -rf build/ node_modules/
npm install

# 2. Run build
npm run build

# 3. Test locally
npx serve -s build

# 4. Deploy to Vercel
# - Connect GitHub repo
# - Set environment variables
# - Deploy from branch: claude/explore-repo-01DkWNGUixdA2QjUHs7tfHqo
```

### Known Build Warnings
```
⚠️ Babel preset warning about @babel/plugin-proposal-private-property-in-object
   → Safe to ignore (create-react-app is deprecated)

⚠️ Bundle size larger than recommended (676 kB gzipped)
   → Consider code splitting for production optimization
   → Most size from three.js and dependencies

⚠️ Browserslist data 9 months old
   → Run: npx update-browserslist-db@latest
```

### Vercel Configuration
No `vercel.json` needed for standard Create React App.

**Build Settings:**
- Build Command: `npm run build`
- Output Directory: `build`
- Install Command: `npm install`
- Node Version: 18.x

### Common Deployment Issues

**1. "Cannot access 'Ht' before initialization"**
- ✓ Fixed: Removed duplicate AuthProvider files
- ✓ Fixed: Updated to React 18 createRoot API
- Commits: 76b8688, b857330, a1be450

**2. "Branch not found"**
- Branch exists: `claude/explore-repo-01DkWNGUixdA2QjUHs7tfHqo`
- Try: Refresh Vercel's branch list
- Alternative: Deploy from commit SHA `b857330`

**3. Backend API calls failing**
- Check: `REACT_APP_API_URL` is set correctly
- Ensure: CORS is enabled on backend
- Verify: Backend is deployed separately (Express server)

---

## Git Workflow

### Current Branch
```bash
claude/explore-repo-01DkWNGUixdA2QjUHs7tfHqo
```

### Recent Commits
```
b857330 - Update to React 18 createRoot API
76b8688 - Remove unused duplicate AuthProvider.jsx file
a1be450 - Fix duplicate AuthProvider causing initialization error
e6473e2 - Disable broken OWID integration, use World Bank instead
6e3d1e2 - Make AI chat adaptive for discovering datasets
0d0e597 - Restore AI chat integration with backend
8b28b7d - Restore World Bank dataset search functionality
```

### Commit Guidelines
```bash
# Good commit message format:
git commit -m "Fix dataset search non-functional issue

- Uncommented World Bank API imports
- Implemented handleSearch callback
- Added INDICATOR_ALIASES mapping
- Tested with GDP and population queries"

# Use heredoc for multi-line messages
git commit -m "$(cat <<'EOF'
Summary line (imperative mood)

- Detailed point 1
- Detailed point 2
- Testing notes
EOF
)"
```

---

## Troubleshooting Guide

### Dataset Search Returns No Results
1. Check World Bank API is accessible: `curl https://api.worldbank.org/v2/country?format=json`
2. Verify `worldBankApi.js` is imported in ReactGlobeExample.jsx
3. Check `handleSearch()` is bound to search button onClick
4. Console log the API response to debug filtering

### AI Chat Not Controlling Globe
1. Verify `/api/chat` endpoint is running on backend
2. Check `REACT_APP_API_URL` environment variable
3. Ensure `handleChatSend()` is calling backend, not OpenAI directly
4. Look for `__GLOBE__` or `__PLOT__` in AI responses
5. Check OpenAI API key is valid in backend `.env`

### Build Failing
```bash
# Clear caches
rm -rf node_modules/ build/ package-lock.json

# Reinstall
npm install

# Try build again
npm run build

# If still fails, check for:
# - Circular dependencies: npx madge --circular src/
# - Duplicate exports: grep -r "export.*AuthProvider" src/
# - Missing dependencies: npm ls
```

### Voice/Realtime Not Working
1. Check WebSocket connection: Browser DevTools → Network → WS
2. Verify backend `/api/realtime/ws` endpoint exists
3. Check microphone permissions in browser
4. Look for errors in console during `startRealtime()`

---

## Future Considerations

### Performance Optimizations
- Implement code splitting with React.lazy()
- Lazy load Three.js globe on demand
- Use Web Workers for heavy data processing
- Implement virtual scrolling for large dataset lists

### Feature Enhancements
- Restore OWID integration when endpoints are fixed
- Add more data sources (UN, IMF, etc.)
- Implement dataset comparison mode
- Add time-series animation playback
- Export visualizations as images/videos

### Technical Debt
- Migrate remaining class components to functional
- Consolidate duplicate context providers
- Update create-react-app to Vite
- Add comprehensive TypeScript types
- Implement unit tests for critical paths

### Known Limitations
- OWID API completely non-functional (DNS/404 errors)
- World Bank API pagination limited to 20,000 records
- Three.js bundle size is large (~300kB)
- No offline mode or data caching
- Voice features require modern browser APIs

---

## Developer Notes

### What This Session Fixed
Starting from a broken `mobile-optimized-refactor` branch:
1. ✓ Dataset search completely non-functional → Restored World Bank integration
2. ✓ AI chat couldn't control globe → Reconnected to backend function calling
3. ✓ AI limited to pre-configured datasets → Made adaptive with dynamic discovery
4. ✓ OWID integration broken → Disabled gracefully, directed to World Bank
5. ✓ Production build initialization error → Fixed duplicate AuthProviders + React 18 API

### Critical Files Modified
- `/src/components/ReactGlobeExample.jsx` - Main app orchestrator (237 lines changed)
- `/src/index.js` - React 18 createRoot API, removed duplicate wrapper
- `/server/index.js` - Disabled OWID, enhanced AI system prompt
- `/src/contexts/AuthProvider.jsx` - Deleted (duplicate)

### Architecture Insights
- **ReactGlobeExample.jsx is the heart** - It orchestrates all features, handles chat, datasets, and view modes
- **Backend function calling is powerful** - AI naturally discovers datasets via conversation
- **Event bus enables loose coupling** - Voice/Avatar/UI communicate without direct dependencies
- **Feature folders improve organization** - Modular architecture makes navigation easier

### What Works Well
- World Bank API integration is solid
- AI function calling is robust and extensible
- Globe rendering is performant
- Authentication flow is clean
- Feature-based architecture scales well

### What Needs Attention
- OWID endpoints are completely dead (external issue)
- Build bundle size could be optimized
- Some legacy components in `/src/components/` could migrate to `/src/features/`
- More comprehensive error handling needed
- Documentation of individual feature modules

---

**Last Updated:** 2024-11-16 (Session: claude/explore-repo-01DkWNGUixdA2QjUHs7tfHqo)
**Status:** ✓ All critical issues resolved, ready for deployment
**Next Steps:** Test Vercel deployment, monitor for runtime issues
