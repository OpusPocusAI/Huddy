// src/contexts/AuthProvider.jsx
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as api from '../services/authClient';

const AuthCtx = createContext();

export function useAuth() {
  return useContext(AuthCtx);
}

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem('jwt') || ''; }
    catch { return ''; }
  });
  const [loading, setLoading] = useState(!!token);

  // -----------------------------------------------------------------------
  // bootstrap session from stored JWT
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!token) { setLoading(false); return; }
    (async () => {
      try {
        const me = await api.getMe(token);
        setUser(me);
      } catch {
        // invalid token → clear
        localStorage.removeItem('jwt');
        setToken('');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  // -----------------------------------------------------------------------
  // E-mail / password helpers
  // -----------------------------------------------------------------------
  const continueWithEmail = useCallback(async (email, password) => {
    const { exists } = await api.checkEmail(email);
    const fn = exists ? api.login : api.signup;
    const { token: t, user: u } = await fn(email, password);
    localStorage.setItem('jwt', t);
    setToken(t);
    setUser(u);
  }, []);

  // -----------------------------------------------------------------------
  // OAuth helpers (Google / GitHub) – handled via popup + postMessage
  // -----------------------------------------------------------------------
  const continueWithOAuth = useCallback((provider) => {
    const popup = api.openOAuthPopup(provider);
    if (!popup) return Promise.reject(new Error('Popup blocked'));

    return new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          reject(new Error('Authentication cancelled'));
        }
      }, 500);

      function handler(evt) {
        if (evt.origin !== process.env.REACT_APP_SERVER_ROOT_URL && evt.origin !== window.location.origin) return;
        try {
          const { token: t, user: u } = evt.data || {};
          if (t && u) {
            localStorage.setItem('jwt', t);
            setToken(t);
            setUser(u);
            resolve(u);
          } else {
            reject(new Error('Bad auth payload'));
          }
        } finally {
          clearInterval(timer);
          window.removeEventListener('message', handler);
          popup.close();
        }
      }
      window.addEventListener('message', handler);
    });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('jwt');
    setToken('');
    setUser(null);
  }, []);

  const value = {
    user,
    token,
    loading,
    continueWithEmail,
    continueWithGoogle: () => continueWithOAuth('google'),
    continueWithGitHub: () => continueWithOAuth('github'),
    logout
  };

  return (
    <AuthCtx.Provider value={value}>
      {children}
    </AuthCtx.Provider>
  );
}