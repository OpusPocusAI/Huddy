import React from 'react';
import { ThemeProvider } from './ThemeContext';
import { AuthProvider } from './AuthContext';
import { UiModeProvider } from './UiModeContext';

/**
 * Single provider wrapper to ensure consistent initialization order
 * This helps webpack/terser maintain proper dependency order during minification
 */
export default function AppProviders({ children }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <UiModeProvider>
          {children}
        </UiModeProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
