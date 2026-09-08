'use client';

import { useSyncExternalStore } from 'react';
import { Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';

const KEY = 'inference-autopilot-theme';
function subscribe(onChange: () => void) {
  const sync = () => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark') {
        document.documentElement.classList.toggle('dark', saved === 'dark');
        document.documentElement.classList.toggle('light', saved === 'light');
      }
    } catch {
      /* Device storage is optional. */
    }
    onChange();
  };
  window.addEventListener('storage', sync);
  window.addEventListener('autopilot-theme', onChange);
  return () => {
    window.removeEventListener('storage', sync);
    window.removeEventListener('autopilot-theme', onChange);
  };
}
export default function ThemeToggle() {
  const dark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains('dark'),
    () => true,
  );
  function toggle() {
    const next = dark ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
    document.documentElement.classList.toggle('light', next === 'light');
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* Theme still works without persistence. */
    }
    window.dispatchEvent(new Event('autopilot-theme'));
  }
  return (
    <Button
      variant="outline"
      className="theme-toggle"
      onClick={toggle}
      aria-label={dark ? 'Switch to day mode' : 'Switch to night mode'}
      title={dark ? 'Switch to day mode' : 'Switch to night mode'}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
      <span>{dark ? 'Day mode' : 'Night mode'}</span>
    </Button>
  );
}
