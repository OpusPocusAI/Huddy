/**
 * ReactGlobeExample.jsx
 *
 * Renders an interactive 3D globe with a futuristic HUD.
 */
import React, { useEffect, useState, useRef, useMemo, useCallback, useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import API from '../utils/api';
import ParticlesBackground from './Effects/ParticlesBackground';
import ScannerEffect from './Effects/ScannerEffect';
import GlowOverlay from './Effects/GlowOverlay';
// import Portal from './Portal';
// Removed direct three.js imports from composer; managed inside feature modules
import GraphViewContainer from '../features/home/GraphViewContainer';
import HomePane from '../features/home/HomePane';
import ChatPane from '../features/chat/ChatPane';
import LayoutShell from '../features/ui/LayoutShell';
import TooltipLayer from '../features/ui/TooltipLayer';
// removed unused event bus in composer; features dispatch directly
// removed unused Globe import; handled inside HomeGlobeView
import HomeGlobeView from '../features/home/HomeGlobeView';
import DatasetControllerContainer from '../features/ui/DatasetControllerContainer';
import BottomHudContainer from '../features/ui/BottomHudContainer';
import LeftSidebarContainer from '../features/ui/LeftSidebarContainer';
import RightSidebarContainer from '../features/ui/RightSidebarContainer';
import TopHudContainer from '../features/ui/TopHudContainer';
import CursorOverlays from '../features/ui/CursorOverlays';
import ResetGlobeContainer from '../features/ui/ResetGlobeContainer';
import OrientationPrompt from '../features/ui/OrientationPrompt';
// import MiniChat from '../features/ui/MiniChat';
// removed unused d3 color scale imports
import useOwidBaselines from '../hooks/useOwidBaselines';
import useDatasetMapping from '../hooks/useDatasetMapping';
import useDatasetSelection from '../features/datasets/useDatasetSelection';
// removed unused datasetsApi import
import { DatasetProvider, useDatasets } from '../features/datasets/DatasetContext';
import DatasetSelector from '../features/datasets/DatasetSelector';
import ChatWindow from './ChatWindow';
import Settings from '../pages/Settings';
import AvatarRigPanel from '../features/avatar/AvatarRigPanel';
// Lazy-load heavy Ideologram components
const IdeologramPanel = React.lazy(() => import('../features/ideologram/IdeologramPanel'));
const IdeologramView = React.lazy(() => import('../features/ideologram/IdeologramView'));
// const EnrichmentDetailModalLazy = React.lazy(() => import('../features/ideologram/EnrichmentDetailModal'));
import WorldviewAssessmentModal from '../features/ideologram/WorldviewAssessmentModal';
import SettingsGearContainer from '../features/ui/SettingsGearContainer';
// import ModeControlsBar from '../features/ui/ModeControlsBar';
// LeftSidebar content panels are managed inside containers; composer does not import them directly
// Ideologram left-sidebar panels are rendered via LeftSidebarContent in ideologram mode
import LiquidGlassShaderBackground from './Effects/LiquidGlassShaderBackground';
import ErrorBoundary from './ErrorBoundary';
// Audio/Avatar dev imports are handled by separate feature flags/routes
// import FacePreview from '../features/avatar/FacePreview';
// import AvatarHead from '../features/avatar/AvatarHead';
// import RealtimeCaptionOverlay from '../features/voice/RealtimeCaptionOverlay';
// import { getCountries, getIndicators } from '../services/worldBankApi';
// import { sendMessage, setApiKey } from '../services/openaiClient';
import { AuthContext } from '../contexts/AuthContext';
const FinancialView = React.lazy(() => import('../features/ui/FinancialView'));
// Ideologram heavy utilities are now isolated in Ideologram page
import { useTheme } from '../contexts/ThemeContext';
import { computeWeightedAverage, computeWorldviewScore as computeWorldviewScoreShared } from '../features/ideologram/worldview';
import worldviewQuizData from '../features/ideologram/worldview.quiz';
// import ThemeDebug from './UI/ThemeDebug';
import { LayoutProvider, useLayout } from '../features/ui/LayoutContext';
import useViewController from '../features/ui/useViewController';
// Keyboard shortcuts and cursor tracking are managed in feature modules
import useCpuMonitor from '../hooks/useCpuMonitor';
import useOrbitControls from '../hooks/useOrbitControls';
import useGlobeBehaviors from '../features/globe/useGlobeBehaviors';
import useDeepStateFeatures from '../features/globe/useDeepStateFeatures';
import useCountriesGeoJSON from '../hooks/useCountriesGeoJSON';
// Tooltip handling is event-driven; no local hover hook needed

function ReactGlobeExampleInner() {
  // -------------------------------
  // REFS & STATE
  // -------------------------------
  const navigate = useNavigate();
  const location = useLocation();
  const globeRef = useRef(null);
  const isUserInteracting = useRef(false);
  const autoRotateAnimationId = useRef(null);
  const initialLoadRef = useRef(true);
  const { isLiquidGlassActive } = useTheme();

  const countries = useCountriesGeoJSON();
  // Hover handled within globe/tooltip features

  // normalizeCountryName is defined and used within Globe feature modules

  // Basic layout & resizing (via context)
  const { sidebarWidths, dimensions, isResizing, setIsResizing, setSidebarWidths, setDimensions } = useLayout();
  // Mode: 'home' = globe & mini-chat; 'chat' = full chat view; 'settings' = settings in center; 'financial' = financial mode; 'avatar' = avatar rigging panel
  const [mode, setMode] = useState('home'); // modes: home, chat, settings, financial, avatar
  // Sync URL <-> mode (lightweight route-splitting)
  useEffect(() => {
    const path = location.pathname;
    if (path.startsWith('/chat')) setMode('chat');
    else if (path.startsWith('/settings')) setMode('settings');
    else if (path.startsWith('/financial')) setMode('financial');
    else if (path.startsWith('/ideologram')) setMode('ideologram');
    else if (path.startsWith('/avatar')) setMode('avatar');
    else setMode('home');
  }, [location.pathname]);

  useEffect(() => {
    // Keep most modes in sync with URL, but render Settings inline in the central pane
    switch (mode) {
      case 'chat': navigate('/chat', { replace: true }); break;
      case 'financial': navigate('/financial', { replace: true }); break;
      case 'ideologram': navigate('/ideologram', { replace: true }); break;
      case 'avatar': navigate('/avatar-rig', { replace: true }); break;
      case 'settings': navigate('/settings', { replace: true }); break;
      default: navigate('/', { replace: true });
    }
  }, [mode, navigate]);
  const { showFinancial, setShowFinancial, warRoomMode, setWarRoomMode, goHome, openFinancial, toggleWarRoom, onExitFinancial } = useViewController({ setMode });

  // UI and panel visibility
  const [leftHidden, setLeftHidden] = useState(false);
  const [rightHidden, setRightHidden] = useState(false);
  const prevSidesRef = useRef({ left: false, right: false });
  const { hamburgerOpen, setHamburgerOpen } = useViewController({ setMode });
  const [showSettings, setShowSettings] = useState(false);
  const [settingsHoverCount, setSettingsHoverCount] = useState(0);

  // Visual effects and toggles
  const [glowEnabled, setGlowEnabled] = useState(true);
  const [lowPowerMode, setLowPowerMode] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [glowIntensity] = useState(1);
  const [showParticles, setShowParticles] = useState(true);
  const [particlesOpacity, setParticlesOpacity] = useState(0.5);
  const [showOrientationPrompt, setShowOrientationPrompt] = useState(() => {
    try {
      const saved = sessionStorage.getItem('orientationPrompt');
      return saved !== 'dismissed' && window.innerHeight > window.innerWidth;
    } catch { return false; }
  });
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
  const touchStartRef = useRef({ x: 0, y: 0, t: 0 });

  // Cursor tracking and tooltip
  const [cursorMode, setCursorMode] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(null);
  const [cursorCountry, setCursorCountry] = useState(null);
  const [cursorHoverCountry, setCursorHoverCountry] = useState(null);
  // Tooltip coordinates managed inside TooltipLayer

  // Globe controls
  const [rotationEnabled, setRotationEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem('rotationEnabled');
      if (saved === null) return true; // default ON
      return saved === 'true';
    } catch {
      return true;
    }
  });
  const [isGlobeReady, setIsGlobeReady] = useState(false);
  const [updateFPS, setUpdateFPS] = useState(() => {
    const saved = Number(localStorage.getItem('updateFPS'));
    return Number.isFinite(saved) && saved > 0 ? saved : 24;
  });
  const [enableCpuMonitor, setEnableCpuMonitor] = useState(false);
  const [cpuUsage, setCpuUsage] = useState(0);
  const [showGlobe, setShowGlobe] = useState(true);
  const [showGlobeTexture, setShowGlobeTexture] = useState(true);
  const [globeTextureType, setGlobeTextureType] = useState('day');
  const [globeOpacity, setGlobeOpacity] = useState(1);
  const [materialType, setMaterialType] = useState('phong');
  const [showGraticules, setShowGraticules] = useState(false);
  const [showAtmosphere, setShowAtmosphere] = useState(true);

  // Dataset and graph state
  const [showGraph, setShowGraph] = useState(false);
  const [activeDataset, setActiveDataset] = useState(null);
  const [selectedDataset, setSelectedDataset] = useState('');
  const [activeGlobeDataset, setActiveGlobeDataset] = useState(null);
  const [isGlobeReset, setIsGlobeReset] = useState(false);
  const [populationData, setPopulationData] = useState([]);
  const [lifeExpData, setLifeExpData] = useState([]);
  const [gdpData, setGdpData] = useState([]);
  const [populationYears, setPopulationYears] = useState([]);
  const [lifeExpYears, setLifeExpYears] = useState([]);
  const [gdpYears, setGdpYears] = useState([]);
  const [selectedPopulationYear, setSelectedPopulationYear] = useState(null);
  const [selectedLifeExpYear, setSelectedLifeExpYear] = useState(null);
  const [selectedGdpYear, setSelectedGdpYear] = useState(null);
  const [availableRegions, setAvailableRegions] = useState([]);
  const [selectedRegion, setSelectedRegion] = useState('World');

  // Hide sidebars in avatar rig mode; restore when leaving
  useEffect(() => {
    if (mode === 'avatar') {
      prevSidesRef.current = { left: leftHidden, right: rightHidden };
      setLeftHidden(true);
      setRightHidden(true);
    } else {
      const prev = prevSidesRef.current;
      if (prev) {
        setLeftHidden(prev.left);
        setRightHidden(prev.right);
      }
    }
  }, [mode]);
  const [isLoadingGlobeData, setIsLoadingGlobeData] = useState(false);
  const [globeDataError, setGlobeDataError] = useState(null);

  // Dataset search and UI helpers
  const [datasetQuery, setDatasetQuery] = useState('');
  const [datasetSearchResults, setDatasetSearchResults] = useState([]);
  const [countryList, setCountryList] = useState([]);
  const leftSidebarContentRef = useRef(null);

  // Provider-driven datasets
  const {
    available: ctxAvailable,
    selectedId: ctxSelectedId,
    series: ctxSeries,
    years: ctxYears,
    selectedYear: ctxSelectedYear,
    isLoading: ctxIsLoading,
    select: selectDatasetFromProvider
  } = useDatasets();

  // Chat/Ideologram minimal placeholders to avoid runtime errors
  const [ideoScores, setIdeoScores] = useState([]);
  const [ideoBooks, setIdeoBooks] = useState([]);
  const [ideoChatHistory, setIdeoChatHistory] = useState([]);
  // const [enrichmentDetail, setEnrichmentDetail] = useState(null);
  const [fileTree, setFileTree] = useState(null);
  // const [fileOpen, setFileOpen] = useState({}); // no longer used in left sidebar
  const [filePreviews, setFilePreviews] = useState({});

  const handleNewChat = useCallback(() => {}, []);
  const openConversation = useCallback(() => {}, []);
  const handleChatSend = useCallback(async () => {}, []);
  const handleSearch = useCallback(async () => {
    const q = datasetQuery.trim();
    if (!q) return;

    try {
      // Fetch indicators directly instead of importing to avoid initialization issues
      const indicatorsUrl = new URL('https://api.worldbank.org/v2/indicator');
      indicatorsUrl.searchParams.set('format', 'json');
      indicatorsUrl.searchParams.set('per_page', '1000');
      const indicatorsRes = await fetch(indicatorsUrl);
      if (!indicatorsRes.ok) throw new Error('Failed to fetch indicators');
      const indicatorsJson = await indicatorsRes.json();

      if (Array.isArray(indicatorsJson) && indicatorsJson.length >= 2) {
        const allIndicators = indicatorsJson[1];
        const query = q.toLowerCase();
        const matchingIndicators = allIndicators.filter(ind =>
          ind.name.toLowerCase().includes(query) || ind.id.toLowerCase().includes(query)
        );

        if (matchingIndicators.length > 0) {
          setDatasetSearchResults(matchingIndicators.slice(0, 10));
          setCountryList([]);
          return;
        }
      }

      // If no indicators found, try countries
      const countriesUrl = new URL('https://api.worldbank.org/v2/country');
      countriesUrl.searchParams.set('format', 'json');
      countriesUrl.searchParams.set('per_page', '1000');
      const countriesRes = await fetch(countriesUrl);
      if (!countriesRes.ok) throw new Error('Failed to fetch countries');
      const countriesJson = await countriesRes.json();

      if (Array.isArray(countriesJson) && countriesJson.length >= 2) {
        const allCountries = countriesJson[1];
        const query = q.toLowerCase();
        const matchingCountries = allCountries.filter(c =>
          c.name.toLowerCase().includes(query) ||
          c.iso2Code.toLowerCase() === query ||
          c.id.toLowerCase() === query
        );
        setCountryList(matchingCountries);
        setDatasetSearchResults([]);
      }
    } catch (error) {
      console.error('Search error:', error);
      setDatasetSearchResults([]);
      setCountryList([]);
    }
  }, [datasetQuery]);

  // Friendly slug ➜ World-Bank indicator mapping
  const INDICATOR_ALIASES = {
    '6.0.GDP_usd': 'NY.GDP.MKTP.KD',          // GDP (constant 2005 $)
    'GDP_pc_PPP_2011': 'NY.GDP.PCAP.PP.KD',  // GDP per capita, PPP (constant 2011)
  };

  const handleProcessDataset = useCallback((datasetId) => {
    const realId = INDICATOR_ALIASES[datasetId] || datasetId;
    handleDatasetSelect(realId, 'graph');
  }, [handleDatasetSelect]);
  // Chat history & current conversation
  const [chatHistory, setChatHistory] = useState([]);
  const [currentConvId, setCurrentConvId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState([]);
  const [apiError, setApiError] = useState(null);
  // const [model] = useState('gpt-5');
  
  // Comprehensive Worldview Assessment System
  const worldviewQuiz = useMemo(() => worldviewQuizData, []);
  
  const [worldviewResponses, setWorldviewResponses] = useState({});
  const [worldviewQuizOpen, setWorldviewQuizOpen] = useState(false);
  const [userCredentials, setUserCredentials] = useState({});
  const [selfAssessment, setSelfAssessment] = useState({});
  const [confidenceScores, setConfidenceScores] = useState({});
  const [assessmentHistory, setAssessmentHistory] = useState([]);
  const [currentAssessment, setCurrentAssessment] = useState(null);
  // Ideologram state moved to Ideologram page
  
  // Ideologram state moved to Ideologram page

  // Save assessment results with metadata
  const saveAssessment = useCallback(async (scores, quizResponses, books, chatHistory = []) => {
    const assessment = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      scores,
      quizResponses,
      booksCount: books?.length || 0,
      enrichedBooksCount: books?.filter(b => b.enriched)?.length || 0,
      chatHistoryCount: chatHistory?.length || 0,
      metadata: {
        vectorResolution: Object.keys(scores).length, // 5 dimensions
        totalDataPoints: Object.values(scores).reduce((sum, dim) => sum + dim.sources.length, 0),
        averageConfidence: Object.values(scores).reduce((sum, dim) => sum + dim.overallConfidence, 0) / Object.keys(scores).length,
        assessmentQuality: chatHistory?.length > 0 ? 'comprehensive' : 'basic', // Enhanced with chat history
        reliabilityScore: Math.min(1, Object.values(scores).reduce((sum, dim) => sum + dim.overallConfidence, 0) / Object.keys(scores).length),
        dataSources: [
          ...(books?.length > 0 ? ['books'] : []),
          ...(Object.keys(quizResponses).length > 0 ? ['quiz'] : []),
          ...(chatHistory?.length > 0 ? ['chat_history'] : [])
        ]
      }
    };
    
    // Save to backend if authenticated, otherwise localStorage
    try {
      await API.post('/api/ideologram/assessments', assessment);
    } catch (err) {
      // Fallback to localStorage
      const existing = JSON.parse(localStorage.getItem('ideologram:assessments') || '[]');
      existing.push(assessment);
      localStorage.setItem('ideologram:assessments', JSON.stringify(existing));
    }
    
    // Update local state
    setAssessmentHistory(prev => [assessment, ...prev]);
    setCurrentAssessment(assessment);
    
    return assessment;
  }, []);
  
  // moved: computeWeightedAverage to features/ideologram/worldview
  
  // Use shared compute function for consistency with Ideologram
  const computeWorldviewScore = useCallback(
    (books, quizResponses, credentials, selfAssessment, chatHistory = []) =>
      computeWorldviewScoreShared(books, quizResponses, credentials, selfAssessment, chatHistory),
    []
  );
  
  // moved: parseChatGPTHistory to features/ideologram/chatUtils
  
  // Enhanced enrichment function moved to features/ideologram/enrichment

  // const handleFileClick = useCallback(async (name) => {}, []);

  // Auto-rotation and ready behavior handled by hook
  const { onGlobeReady } = useGlobeBehaviors({ rotationEnabled, globeRef, isUserInteracting, setIsGlobeReady, setUpdateFPS });

  // CPU load monitoring (if enabled)
  useEffect(() => {
    if (!enableCpuMonitor) return;
    let lastTime = performance.now();
    let frameCount = 0;
    let rafId;
    const checkLoad = () => {
      const now = performance.now();
      frameCount++;
      if (now >= lastTime + 1000) {
        const targetFPS = 30;
        const actualFPS = frameCount / ((now - lastTime) / 1000);
        const load = 100 - Math.min((actualFPS / targetFPS) * 100, 100);
        setCpuUsage(load);
        frameCount = 0;
        lastTime = now;
      }
      rafId = requestAnimationFrame(checkLoad);
    };
    rafId = requestAnimationFrame(checkLoad);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      setCpuUsage(0);
    };
  }, [enableCpuMonitor]);

  // Hover handler: drive tooltip events (extracted)
  // Hover handled within GlobeController/TooltipLayer

  // -------------------------------
  // DATA FETCHING & MERGING
  // -------------------------------
  // Baseline datasets (OWID) via hook
  useOwidBaselines({
    setAvailableRegions,
    setLifeExpYears,
    setSelectedLifeExpYear,
    setLifeExpData,
    setPopulationYears,
    setSelectedPopulationYear,
    setPopulationData,
  });

  // Datasets are now provided via DatasetProvider; fetching moved there.

  // Switch to provider-driven dataset loading: map provider series into local dataset-specific shapes
  useDatasetMapping({
    ctxSelectedId,
    ctxSeries,
    ctxYears,
    ctxSelectedYear,
    ctxIsLoading,
    setIsLoadingGlobeData,
    setGlobeDataError,
    setPopulationData,
    setPopulationYears,
    setSelectedPopulationYear,
    setLifeExpData,
    setLifeExpYears,
    setSelectedLifeExpYear,
    setGdpData,
    setGdpYears,
    setSelectedGdpYear,
  });

  // Debug GDP state
  useEffect(() => {
    console.log('=== GDP STATE ===', {
      activeGlobeDataset,
      gdpDataCount: gdpData.length,
      gdpYears,
      selectedGdpYear
    });
  }, [activeGlobeDataset, gdpData, gdpYears, selectedGdpYear]);

  // Dataset selection
  const { handleDatasetSelect, handleResetGlobe } = useDatasetSelection({
    ctxAvailable,
    datasetSearchResults,
    selectDatasetFromProvider,
    setSelectedDataset,
    setIsGlobeReset,
    setActiveGlobeDataset,
    setShowGlobe,
    setShowGraph,
    setActiveDataset,
    setPopulationData,
    setLifeExpData,
    setGdpData,
    setSelectedRegion,
    setSelectedPopulationYear,
    setSelectedLifeExpYear,
    setSelectedGdpYear,
    setGlobeDataError,
  });

  // Debug dataset selection
  useEffect(() => {
    console.log('Selected dataset:', selectedDataset, 'Active globe dataset:', activeGlobeDataset);
  }, [selectedDataset, activeGlobeDataset]);

  const renderDatasetSelector = () => (
    <DatasetSelector
      onSelectGraph={(id) => handleDatasetSelect(id, 'graph')}
      onSelectGlobe={(id) => handleDatasetSelect(id, 'globe')}
    />
  );

  // Reset globe
  // reset moved to useDatasetSelection

  // -------------------------------
  // RENDER
  // -------------------------------
  

  // Auth state and avatars for mini chat
  const { user, logout, loginWithGoogle, isLoggedIn } = useContext(AuthContext);
  const defaultAssistantAvatar = '/default-assistant-avatar.png';
  // Load assistant and user avatars from storage or defaults
  const assistantAvatarUrl = localStorage.getItem('assistantAvatarUrl') || defaultAssistantAvatar;
  const userAvatarUrl = localStorage.getItem('avatarUrl') || user?.avatarUrl || '';
  // Removed: expandedAvatarUrl not used in composer; track via local storage only
  // const [expandedAvatarUrl, setExpandedAvatarUrl] = useState(null);

  // warRoomMode managed by view controller hook
  const [civAge, setCivAge] = useState(12000);

  const [deepStateFeatures, setDeepStateFeatures] = useState([]);
  
  // [REMOVED - duplicate] Cursor mode state
  
  // Voice/Avatar rigging controls removed from core composer; managed in voice feature
  useDeepStateFeatures({ setDeepStateFeatures });

  return (
    <div 
      className={`relative flex w-screen h-screen text-gray-100 overflow-hidden font-sciFi bg-black ${
        isLiquidGlassActive ? 'liquid-glass-effect' : ''
      } ${cursorMode ? 'cursor-mode-active' : ''}`}
      style={{}}
    >
      {isLiquidGlassActive && <LiquidGlassShaderBackground />}
      <ParticlesBackground show={showParticles} opacity={particlesOpacity} />

      <TopHudContainer
        visible={mode !== 'chat' && mode !== 'settings' && mode !== 'ideologram'}
        glowEnabled={glowEnabled}
        dimensionsTop={dimensions.top}
        warRoomMode={warRoomMode}
        leftHidden={leftHidden}
        rightHidden={rightHidden}
        sidebarWidths={sidebarWidths}
        isResizing={isResizing}
        setIsResizing={setIsResizing}
        isLoggedIn={isLoggedIn}
        setMode={setMode}
        setShowFinancial={setShowFinancial}
        setShowGraph={setShowGraph}
        setWarRoomMode={setWarRoomMode}
      />
      
      {leftHidden && false && (
                  <button
          onClick={() => setLeftHidden(false)}
          className="fixed left-1 top-1/2 -translate-y-1/2 bg-gray-800/90 p-2 sm:p-3
            rounded-r-md shadow-lg hover:bg-gray-700 transition-colors z-40
            border border-neon-blue/30"
        >
          &gt;
                     </button>
                   )}

      {/* CENTER CONTAINER */}
      <LayoutShell
        leftHidden={leftHidden}
        rightHidden={rightHidden}
        leftWidthVw={sidebarWidths.left}
        rightWidthVw={sidebarWidths.right}
        onTouchStart={(e) => {
          try {
            const t = e.touches && e.touches[0];
            if (!t) return;
            touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
                        } catch {}
        }}
        onTouchEnd={(e) => {
          if (!isMobile) return;
          try {
            const s = touchStartRef.current;
            const t = (e.changedTouches && e.changedTouches[0]) || null;
            if (!t || !s) return;
            const dx = t.clientX - s.x;
            const dy = t.clientY - s.y;
            const adx = Math.abs(dx), ady = Math.abs(dy);
            const edge = 24; // px edge zone
            if (ady < 40 && adx > 40) {
              // swipe from left edge to open left
              if (s.x <= edge && dx > 0) setLeftHidden(false);
              // swipe from right edge to open right
              if (s.x >= (window.innerWidth - edge) && dx < 0) setRightHidden(false);
              // swipe left to close left drawer
              if (!leftHidden && dx < -40) setLeftHidden(true);
              // swipe right to close right drawer
              if (!rightHidden && dx > 40) setRightHidden(true);
                          }
                        } catch {}
        }}
      >
        {/* Mobile edge openers for drawers */}
        {(typeof window !== 'undefined' && window.innerWidth <= 768) && (
          <>
            {leftHidden && (
              <div
                onClick={() => setLeftHidden(false)}
                onTouchStart={() => setLeftHidden(false)}
                className="fixed top-1/2 -translate-y-1/2 left-0 w-6 h-16 bg-gray-800/60 border-r border-gray-600 rounded-r-lg z-40"
                style={{}}
                aria-label="Open left drawer"
              />
            )}
            {rightHidden && (
              <div
                onClick={() => setRightHidden(false)}
                onTouchStart={() => setRightHidden(false)}
                className="fixed top-1/2 -translate-y-1/2 right-0 w-6 h-16 bg-gray-800/60 border-l border-gray-600 rounded-l-lg z-40"
                style={{}}
                aria-label="Open right drawer"
              />
            )}
            {/* Overlay to close drawers - only on mobile when sidebars are open */}
            {isMobile && (!leftHidden || !rightHidden) && (
              <div
                className="fixed inset-0 z-20 bg-black/30"
                onClick={() => { setLeftHidden(true); setRightHidden(true); }}
                onTouchStart={() => { setLeftHidden(true); setRightHidden(true); }}
                aria-hidden="true"
              />
            )}
            </>
          )}
        {showOrientationPrompt && mode === 'home' && (
          <OrientationPrompt
            onDismiss={() => { try { sessionStorage.setItem('orientationPrompt', 'dismissed'); } catch {} setShowOrientationPrompt(false); }}
            onPreview={() => { setShowOrientationPrompt(false); setShowAtmosphere(false); setShowGlobeTexture(true); setUpdateFPS(24); }}
          />
        )}
        {mode === 'chat' && (
          <ChatPane
            apiError={apiError}
              messages={currentConversation}
              onSend={handleChatSend}
            sidebarWidths={sidebarWidths}
            leftHidden={leftHidden}
            rightHidden={rightHidden}
            />
        )}
        {mode === 'settings' && (
          <Settings />
        )}
        {mode === 'avatar' && (
          <AvatarRigPanel onClose={() => setMode('home')} />
        )}
        <HomePane
          mode={mode}
          showGraph={showGraph}
          activeDataset={activeDataset}
          onCloseGraph={() => {
              setShowGraph(false);
              setActiveDataset(null);
              setSelectedDataset('');
              setShowGlobe(true);
            }}
          rightHidden={rightHidden}
          sidebarWidths={sidebarWidths}
          homeProps={{
            showFinancial,
            showGlobe,
            countries,
            warRoomMode,
            deepStateFeatures,
            materialType,
            globeTextureType,
            globeOpacity,
            showGraticules,
            showAtmosphere,
            onGlobeReady,
            showGlobeTexture,
            fpsLimit: updateFPS,
            rotationEnabled,
            activeGlobeDataset,
            populationData,
            lifeExpData,
            gdpData,
            selectedPopulationYear,
            selectedLifeExpYear,
            selectedGdpYear,
            genericSeries: ctxSeries,
            genericSelectedYear: ctxSelectedYear,
            isLoading: isLoadingGlobeData,
            error: globeDataError,
          }}
        />
        {(mode === 'financial' || showFinancial) && mode !== 'chat' && mode !== 'settings' && !showGraph && (
          <React.Suspense fallback={<div className="p-2 text-gray-400">Loading financial…</div>}>
            <ErrorBoundary>
              <FinancialView onExit={onExitFinancial} />
            </ErrorBoundary>
          </React.Suspense>
        )}
        {mode === 'ideologram' && (
          <React.Suspense fallback={<div className="p-2 text-gray-400">Loading ideologram…</div>}>
            <ErrorBoundary>
              <IdeologramPanel>
                <IdeologramView
                  user={user}
                  assessmentHistory={assessmentHistory}
                  computeWeightedAverage={computeWeightedAverage}
                  setWorldviewQuizOpen={setWorldviewQuizOpen}
                  ideoBooks={ideoBooks}
                  setIdeoBooks={setIdeoBooks}
                  ideoEnrichedMap={{}}
                  ideoEnriching={{}}
                  setIdeoChatHistory={setIdeoChatHistory}
                  setFilePreviews={setFilePreviews}
                  onOpenWorldview={() => setWorldviewQuizOpen(true)}
                  weightedScores={{}}
                  setFileTree={setFileTree}
                />
              </IdeologramPanel>
            </ErrorBoundary>
          </React.Suspense>
        )}
      </LayoutShell>
      

      {/* Tooltip moved to TooltipLayer (event-driven) */}
      <TooltipLayer />

      <DatasetControllerContainer
        visible={mode === 'home' && !showFinancial && !showGraph}
        activeGlobeDataset={activeGlobeDataset}
        availableRegions={availableRegions}
        selectedRegion={selectedRegion}
        onChangeRegion={setSelectedRegion}
      />

      <ResetGlobeContainer
        visible={!isGlobeReset && mode === 'home' && !showFinancial && !showGraph}
        onClick={handleResetGlobe}
      />

      {mode === 'home' && !showFinancial && (
        <BottomHudContainer
          glowEnabled={glowEnabled}
          leftHidden={leftHidden}
          rightHidden={rightHidden}
          sidebarWidths={sidebarWidths}
          onOpenSettings={() => setMode('settings')}
          onOpenFinancial={() => setShowFinancial(true)}
          heightVh={dimensions.bottom}
        />
      )}
      {/* LEFT SIDEBAR */}
      <LeftSidebarContainer
        leftHidden={leftHidden}
        sidebarWidthVw={sidebarWidths.left}
        glowEnabled={glowEnabled}
        isResizingLeft={isResizing.left}
        onStartResizeLeft={() => setIsResizing((prev) => ({ ...prev, left: true }))}
        hamburgerOpen={hamburgerOpen}
        onToggleHamburger={() => setHamburgerOpen(open => !open)}
        showHomeButton={Boolean(warRoomMode || showFinancial || mode === 'financial')}
        onGoHome={() => { goHome(); setShowGraph(false); }}
        onGoChat={() => setMode('chat')}
        isHomeMode={mode === 'home'}
        onCollapseLeft={() => setLeftHidden(true)}
        onOpenAccount={() => { setHamburgerOpen(false); setMode('settings'); }}
        onOpenChat={() => { setHamburgerOpen(false); setMode('chat'); }}
        onOpenOtherSettings={() => { setHamburgerOpen(false); setShowSettings(true); }}
        onOpenIdeologram={() => { setHamburgerOpen(false); setMode('ideologram'); setShowFinancial(false); setShowGraph(false); setWarRoomMode(false); }}
        onOpenFinancial={() => { setHamburgerOpen(false); openFinancial(); }}
        onToggleAvatarRig={() => { setHamburgerOpen(false); setMode('avatar'); }}
        onToggleWarRoom={() => { setHamburgerOpen(false); toggleWarRoom(); }}
        warRoomMode={warRoomMode}
        mode={mode}
        chatHistory={chatHistory}
        onNewChat={handleNewChat}
        onOpenConversation={openConversation}
        renderDatasetSelector={renderDatasetSelector}
        datasetQuery={datasetQuery}
        setDatasetQuery={setDatasetQuery}
        handleSearch={handleSearch}
        datasetSearchResults={datasetSearchResults}
        countryList={countryList}
        setSelectedRegion={setSelectedRegion}
        user={user}
        fileTree={fileTree}
        filePreviews={filePreviews}
        onFileClick={() => {}}
        onRefreshFiles={async () => {
          const { buildUserFileTree } = await import('../features/ideologram/fileTree');
          const tree = await buildUserFileTree(user);
                            setFileTree(tree);
        }}
        ideoScores={ideoScores}
        setIdeoScores={setIdeoScores}
        API={API}
        activeGlobeDataset={activeGlobeDataset}
        populationYears={populationYears}
        selectedPopulationYear={selectedPopulationYear}
        setSelectedPopulationYear={setSelectedPopulationYear}
        lifeExpYears={lifeExpYears}
        selectedLifeExpYear={selectedLifeExpYear}
        setSelectedLifeExpYear={setSelectedLifeExpYear}
        gdpYears={gdpYears}
        selectedGdpYear={selectedGdpYear}
        setSelectedGdpYear={setSelectedGdpYear}
        civAge={civAge}
        setCivAge={setCivAge}
        isLoggedIn={isLoggedIn}
        setShowFinancial={setShowFinancial}
        leftSidebarContentRef={leftSidebarContentRef}
        currentConversation={currentConversation}
        handleChatSend={handleChatSend}
        setMode={setMode}
        handleProcessDataset={handleProcessDataset}
      />
      {leftHidden && (
        <button
          onClick={() => setLeftHidden(false)}
          className="fixed left-1 top-1/2 -translate-y-1/2 bg-gray-800/90 p-2 sm:p-3
            rounded-r-md shadow-lg hover:bg-gray-700 transition-colors z-40
            border border-neon-blue/30"
        >
          &gt;
        </button>
      )}

      {/* RIGHT SIDEBAR */}
      <div
        className={`fixed top-0 right-0 h-full z-30 ${
          rightHidden ? 'translate-x-full' : 'translate-x-0'
        } backdrop-blur-lg rounded-l-lg`}
        style={{
          width: `${(typeof window !== 'undefined' && window.innerWidth <= 768) ? 80 : sidebarWidths.right}vw`,
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          transition: isResizing.right ? 'none' : 'transform 0.3s ease-in-out'
        }}
        role="complementary"
        aria-hidden={rightHidden}
      >
        <div className="relative h-full flex flex-col" style={{ userSelect: isResizing.right ? 'none' : 'auto' }}>
          {!rightHidden && (
            <RightSidebarContainer
              glowEnabled={glowEnabled}
              mode={mode}
              onCollapse={() => setRightHidden(true)}
              onStartResizeRight={() => setIsResizing((prev) => ({ ...prev, right: true }))}
            />
          )}
          {!rightHidden && <ScannerEffect show={showScanner} glowIntensity={glowIntensity} />}
        </div>
      </div>
      {rightHidden && (
        <button
          onClick={() => setRightHidden(false)}
          className="fixed right-1 top-1/2 -translate-y-1/2 bg-gray-800/90 p-2 sm:p-3
            rounded-l-md shadow-lg hover:bg-gray-700 transition-colors z-40
            border border-neon-blue/30"
        >
          &lt;
        </button>
      )}

      {/* Glow overlay */}
      <GlowOverlay enabled={glowEnabled} />

      {/* Theme Debug removed */}
      
      <CursorOverlays
        cursorMode={cursorMode}
        cursorPosition={cursorPosition}
        cursorHoverCountry={cursorHoverCountry}
        cursorCountry={cursorCountry}
      />

      {/* Avatar Rigging System removed from composer; owned by voice/avatar feature */}

      <SettingsGearContainer
        glowEnabled={glowEnabled}
        settingsHoverCount={settingsHoverCount}
        setShowSettings={setShowSettings}
        showSettings={showSettings}
        onHover={() => setSettingsHoverCount(c => c + 1)}
        panelProps={{
          user,
          userAvatarUrl,
          mode,
          assessmentHistory,
          isLiquidGlassActive,
          glowEnabled,
          setGlowEnabled,
          lowPowerMode,
          updateFPS,
          setUpdateFPS,
          showScanner,
          setShowScanner,
          cursorMode,
          setCursorMode,
          showParticles,
          setShowParticles,
          particlesOpacity,
          setParticlesOpacity,
          rotationEnabled,
          setRotationEnabled: (v) => { try { localStorage.setItem('rotationEnabled', String(v)); } catch {} setRotationEnabled(v); },
          enableCpuMonitor,
          setEnableCpuMonitor,
          cpuUsage,
          showGlobe,
          setShowGlobe,
          showGlobeTexture,
          setShowGlobeTexture,
          globeTextureType,
          setGlobeTextureType,
          globeOpacity,
          setGlobeOpacity,
          materialType,
          setMaterialType,
          showGraticules,
          setShowGraticules,
          showAtmosphere,
          setShowAtmosphere,
          logout,
          loginWithGoogle,
          navigate,
        }}
      />

        
        <WorldviewAssessmentModal
          isOpen={worldviewQuizOpen}
          onClose={() => setWorldviewQuizOpen(false)}
          assessmentHistory={assessmentHistory}
          computeWeightedAverage={computeWeightedAverage}
          worldviewQuiz={worldviewQuiz}
          worldviewResponses={worldviewResponses}
          setWorldviewResponses={setWorldviewResponses}
          ideoBooks={ideoBooks}
          userCredentials={userCredentials}
          selfAssessment={selfAssessment}
          ideoChatHistory={ideoChatHistory}
          computeWorldviewScore={computeWorldviewScore}
          setConfidenceScores={setConfidenceScores}
          saveAssessment={saveAssessment}
          currentAssessment={currentAssessment}
        />
                    </div>
  );
}

export default function ReactGlobeExample() {
  return (
    <DatasetProvider>
      <LayoutProvider>
        <ReactGlobeExampleInner />
      </LayoutProvider>
    </DatasetProvider>
  );
}
