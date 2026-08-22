import { useState, useEffect } from 'react';
import { THEME_STORAGE_KEY, COLOR_SCHEME_STORAGE_KEY } from '../config/constants';
import type { ColorScheme } from '../config/constants';

function getInitialTheme(): boolean {
  if (typeof window === 'undefined') return false;
  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme) return savedTheme === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function getInitialColorScheme(): ColorScheme {
  if (typeof window === 'undefined') return 'vanaila-origin';
  return (window.localStorage.getItem(COLOR_SCHEME_STORAGE_KEY) as ColorScheme) || 'vanaila-origin';
}

export function useUIState() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [statusText, setStatusText] = useState('Ready');
  const [isDarkMode, setIsDarkMode] = useState(getInitialTheme);
  const [colorScheme, setColorSchemeState] = useState<ColorScheme>(getInitialColorScheme);

  const toggleTheme = () => {
    const next = !isDarkMode;
    setIsDarkMode(next);
    const theme = next ? 'dark' : 'light';
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
  };

  useEffect(() => {
    const theme = isDarkMode ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
  }, [isDarkMode]);

  useEffect(() => {
    if (colorScheme === 'vanaila-origin') {
      document.documentElement.removeAttribute('data-color-scheme');
    } else {
      document.documentElement.setAttribute('data-color-scheme', colorScheme);
    }
  }, [colorScheme]);

  const setColorScheme = (scheme: ColorScheme) => {
    setColorSchemeState(scheme);
    localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, scheme);
  };

  return {
    isSidebarOpen,
    setIsSidebarOpen,
    statusText,
    setStatusText,
    isDarkMode,
    toggleTheme,
    colorScheme,
    setColorScheme,
    openSidebar: () => setIsSidebarOpen(true),
    closeSidebar: () => setIsSidebarOpen(false),
    toggleSidebar: () => setIsSidebarOpen((prev) => !prev),
  };
}
