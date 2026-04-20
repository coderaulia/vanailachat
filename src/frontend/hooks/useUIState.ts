import { useState, useEffect } from 'react';
import { THEME_STORAGE_KEY } from '../config/constants';

function getInitialTheme(): boolean {
  if (typeof window === 'undefined') return false;
  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme) return savedTheme === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useUIState() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [statusText, setStatusText] = useState('Ready');
  const [isDarkMode, setIsDarkMode] = useState(getInitialTheme);

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
  }, []);

  return {
    isSidebarOpen,
    setIsSidebarOpen,
    statusText,
    setStatusText,
    isDarkMode,
    toggleTheme,
    openSidebar: () => setIsSidebarOpen(true),
    closeSidebar: () => setIsSidebarOpen(false),
    toggleSidebar: () => setIsSidebarOpen((prev) => !prev),
  };
}
