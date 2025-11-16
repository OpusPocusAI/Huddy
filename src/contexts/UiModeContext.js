import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';

export const UiModeContext = createContext(null);

export function UiModeProvider({ children }) {
  const [mode, setMode] = useState('home');
  const [showGraph, setShowGraph] = useState(false);
  const [showFinancial, setShowFinancial] = useState(false);
  const [leftHidden, setLeftHidden] = useState(false);
  const [rightHidden, setRightHidden] = useState(false);

  const value = useMemo(() => ({
    mode,
    setMode,
    showGraph,
    setShowGraph,
    showFinancial,
    setShowFinancial,
    leftHidden,
    setLeftHidden,
    rightHidden,
    setRightHidden
  }), [mode, showGraph, showFinancial, leftHidden, rightHidden]);

  return (
    <UiModeContext.Provider value={value}>{children}</UiModeContext.Provider>
  );
}

export function useUiMode() {
  const ctx = useContext(UiModeContext);
  if (!ctx) throw new Error('useUiMode must be used within UiModeProvider');
  return ctx;
}



