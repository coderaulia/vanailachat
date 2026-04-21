import { useEffect } from 'react';

type ShortcutMap = {
  [combo: string]: (e: KeyboardEvent) => void;
};

/**
 * Register keyboard shortcuts. combo format: "ctrl+n", "ctrl+/", "escape", etc.
 * Shortcuts are automatically cleaned up when the component unmounts.
 */
export function useKeyboardShortcuts(shortcuts: ShortcutMap) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push('ctrl');
      if (e.shiftKey) parts.push('shift');
      if (e.altKey) parts.push('alt');

      const key = e.key.toLowerCase();
      parts.push(key);
      const combo = parts.join('+');

      if (shortcuts[combo]) {
        e.preventDefault();
        shortcuts[combo](e);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts]);
}
