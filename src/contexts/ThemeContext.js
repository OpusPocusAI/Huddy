import React, { createContext, useContext, useState, useEffect } from 'react';

// Theme definitions with CSS variable mappings
const themes = {
  default: {
    name: 'Default (Sci-Fi Neon)',
    description: 'Original sci-fi neon aesthetic',
    variables: {
      '--bg-primary': '#000000',
      '--bg-secondary': 'rgba(0, 0, 0, 0.8)',
      '--bg-tertiary': 'rgba(0, 0, 0, 0.4)',
      '--text-primary': '#ffffff',
      '--text-secondary': '#00e6ff',
      '--text-accent': '#6432ff',
      '--border-primary': 'rgba(0, 230, 255, 0.3)',
      '--border-secondary': 'rgba(0, 230, 255, 0.2)',
      '--glow-primary': 'rgba(0, 230, 255, 0.7)',
      '--glow-secondary': 'rgba(100, 50, 255, 0.5)',
      '--button-bg': '#000000',
      '--button-border': '#00e6ff',
      '--button-hover': 'rgba(0, 230, 255, 0.1)',
      '--sidebar-bg': 'rgba(0, 0, 0, 0.8)',
      '--card-bg': 'rgba(0, 0, 0, 0.4)',
      '--input-bg': 'rgba(0, 0, 0, 0.8)',
      '--input-border': 'rgba(0, 230, 255, 0.3)',
      '--shadow-color': 'rgba(0, 230, 255, 0.2)',
    }
  },
  liquidGlass: {
    name: 'Liquid Glass + Shader',
    description: 'Modern glass morphism with liquid effects',
    variables: {
      '--bg-primary': 'rgba(0, 0, 0, 0.95)',
      '--bg-secondary': 'rgba(255, 255, 255, 0.05)',
      '--bg-tertiary': 'rgba(255, 255, 255, 0.02)',
      '--text-primary': '#ffffff',
      '--text-secondary': 'rgba(255, 255, 255, 0.9)',
      '--text-accent': 'rgba(255, 255, 255, 0.8)',
      '--border-primary': 'rgba(255, 255, 255, 0.2)',
      '--border-secondary': 'rgba(255, 255, 255, 0.1)',
      '--glow-primary': 'rgba(255, 255, 255, 0.3)',
      '--glow-secondary': 'rgba(255, 255, 255, 0.2)',
      '--button-bg': 'rgba(255, 255, 255, 0.1)',
      '--button-border': 'rgba(255, 255, 255, 0.2)',
      '--button-hover': 'rgba(255, 255, 255, 0.15)',
      '--sidebar-bg': 'rgba(255, 255, 255, 0.05)',
      '--card-bg': 'rgba(255, 255, 255, 0.08)',
      '--input-bg': 'rgba(255, 255, 255, 0.05)',
      '--input-border': 'rgba(255, 255, 255, 0.2)',
      '--shadow-color': 'rgba(255, 255, 255, 0.1)',
    }
  }
};

export const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [currentTheme, setCurrentTheme] = useState('default');
  const [isLiquidGlassActive, setIsLiquidGlassActive] = useState(false);

  // Apply theme to CSS variables
  const applyTheme = (themeName) => {
    const theme = themes[themeName];
    if (!theme) return;

    console.log(`Applying theme: ${themeName}`, theme);

    // Apply CSS variables to document root
    Object.entries(theme.variables).forEach(([property, value]) => {
      document.documentElement.style.setProperty(property, value);
      console.log(`Set CSS variable: ${property} = ${value}`);
    });

    // Add/remove theme-specific classes (align names with CSS)
    document.body.classList.remove('theme-default', 'theme-liquid-glass', 'theme-liquidGlass');
    const bodyThemeClass = themeName === 'liquidGlass' ? 'theme-liquid-glass' : 'theme-default';
    document.body.classList.add(bodyThemeClass);
    console.log(`Applied theme class: ${bodyThemeClass}`);
    
    // DEBUG: Check if class was actually added
    console.log('Body classes after theme application:', document.body.className);
    console.log('Body element:', document.body);

    // Set liquid glass state
    setIsLiquidGlassActive(themeName === 'liquidGlass');
    
    // Store theme preference
    localStorage.setItem('selectedTheme', themeName);
    
    console.log('Theme application complete');
  };

  // Initialize theme from localStorage or default
  useEffect(() => {
    const savedTheme = localStorage.getItem('selectedTheme') || 'default';
    setCurrentTheme(savedTheme);
    applyTheme(savedTheme);
  }, []);

  // Theme switching function
  const switchTheme = (themeName) => {
    if (themes[themeName]) {
      setCurrentTheme(themeName);
      applyTheme(themeName);
    }
  };

  const value = {
    currentTheme,
    themes,
    switchTheme,
    isLiquidGlassActive
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
