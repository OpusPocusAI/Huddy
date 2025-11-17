import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { UiModeProvider } from './contexts/UiModeContext';
// Removed global Navbar; using sidebar menu instead
import ProtectedRoute from './components/ProtectedRoute';
import Main from './components/Main';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './pages/Login';
import Signup from './pages/Signup';
const Settings = React.lazy(() => import('./pages/Settings'));
const IdeologramPage = React.lazy(() => import('./pages/IdeologramPage'));
const AvatarRigPage = React.lazy(() => import('./pages/AvatarRigPage'));
import VoiceDevWidget from './features/voice/VoiceDevWidget';
import createMcpClient from './shared/agents/mcpClient';
import AvatarDevWidget from './features/voice/AvatarDevWidget';
const AsciiGlobePage = React.lazy(() => import('./pages/AsciiGlobePage'));
import TranscribeDevView from './features/voice/TranscribeDevView';
import VoiceButtons from './features/voice/VoiceButtons';
import RealtimeCaptionOverlay from './features/voice/RealtimeCaptionOverlay';
import VoiceTuner from './features/voice/VoiceTuner';

function App() {
  React.useEffect(() => {
    // MCP config: use REACT_APP_* variables as instructed
    const url = process.env.REACT_APP_MCP_URL;
    const apiKey = process.env.REACT_APP_MCP_API_KEY;
    if (!url || !apiKey) return;
    const client = createMcpClient({ url, apiKey, onOpen: () => {
      client.subscribe(['tasks.*']);
      // REF-001
      client.updateStatus({ task_id: 'REF-001', status: 'in_progress', note: 'Refactor phases P0–P8 underway' });
      client.requestLock({ task_id: 'REF-001', paths: ['src/features/ui/LeftSidebar/**', 'src/features/ui/SettingsPanel/**', 'src/features/ideologram/IdeologramPanel/**'] });
      client.sendHeartbeat({ task_id: 'REF-001', branch: 'feature/refactor-hud-core', sha: '', focus: ['src/components/','src/features/'], locks: ['src/features/ui/LeftSidebar/**'], timestamp: new Date().toISOString(), eta: '', blocked_on: '' });
      // VOICE-003
      client.updateStatus({ task_id: 'VOICE-003', status: 'in_progress', note: 'Realtime + Transcribe integration, lip-sync scaffolding' });
      client.requestLock({ task_id: 'VOICE-003', paths: ['server/index.js', 'src/features/voice/**', 'CC/**'] });
      client.sendHeartbeat({ task_id: 'VOICE-003', branch: 'feature/voice-realtime-transcribe', sha: '', focus: ['server/','src/features/voice/','CC/'], locks: ['server/index.js','src/features/voice/**','CC/**'], timestamp: new Date().toISOString(), eta: '', blocked_on: '' });
    }});
    client.connect();
    // Send heartbeats every 60s for both tasks (locks auto-expire after 180s)
    const interval = setInterval(() => {
      const now = new Date().toISOString();
      client.sendHeartbeat({ task_id: 'REF-001', branch: 'feature/refactor-hud-core', sha: '', focus: ['src/components/','src/features/'], locks: ['src/features/ui/LeftSidebar/**'], timestamp: now, eta: '', blocked_on: '' });
      client.sendHeartbeat({ task_id: 'VOICE-003', branch: 'feature/voice-realtime-transcribe', sha: '', focus: ['server/','src/features/voice/','CC/'], locks: ['server/index.js','src/features/voice/**','CC/**'], timestamp: now, eta: '', blocked_on: '' });
    }, 60000);
    return () => clearInterval(interval);
  }, []);
  return (
    <ThemeProvider>
      <AuthProvider>
        <UiModeProvider>
          <BrowserRouter>
            {/* Removed global Navbar; sidebar menu icons are used instead */}
            <ErrorBoundary>
              <React.Suspense fallback={<div className="p-4 text-gray-400">Loading…</div>}>
                <Routes>
                {/* Public home (globe) view */}
                <Route
                  path="/"
                  element={
                    <ErrorBoundary>
                      <Main />
                    </ErrorBoundary>
                  }
                />
                <Route
                  path="/chat"
                  element={
                    <ErrorBoundary>
                      <Main />
                    </ErrorBoundary>
                  }
                />
                <Route
                  path="/financial"
                  element={
                    <ErrorBoundary>
                      <Main />
                    </ErrorBoundary>
                  }
                />
              {/* Auth routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route
                path="/ideologram"
                element={
                  <ErrorBoundary>
                    <Main />
                  </ErrorBoundary>
                }
              />
              <Route path="/ascii" element={<AsciiGlobePage />} />
              <Route path="/avatar-rig" element={<AvatarRigPage />} />
              {/* Protected user routes */}
              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <Settings />
                  </ProtectedRoute>
                }
              />
                </Routes>
              </React.Suspense>
            </ErrorBoundary>
            {process.env.REACT_APP_VOICE_DEV_WIDGET === '1' && <VoiceDevWidget />}
            {process.env.REACT_APP_AVATAR_DEV_WIDGET === '1' && <AvatarDevWidget />}
            {process.env.REACT_APP_TRANSCRIBE_DEV_VIEW === '1' && <TranscribeDevView />}
            {process.env.REACT_APP_VOICE_BUTTONS === '1' && <VoiceButtons />}
            {process.env.REACT_APP_REALTIME_CAPTIONS === '1' && <RealtimeCaptionOverlay />}
            {process.env.REACT_APP_VOICE_TUNER === '1' && <VoiceTuner />}
          </BrowserRouter>
        </UiModeProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
