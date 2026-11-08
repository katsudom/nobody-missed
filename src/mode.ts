import { useEffect, useState } from 'react';

// What the boards show (Dev tools switch). Per browser, so each laptop picks its own.
//  real: only teammates' real phones.   all: real phones plus fake households / sim / injected cases.
export type Mode = 'real' | 'all';

const KEY = 'nobody-missed/board-mode';
const EVENT = 'nobody-missed:mode';

function read(): Mode {
  // The local sandbox has no real phones, so it shows fake data unless this browser picked otherwise.
  const fallback: Mode = import.meta.env.MODE === 'sandbox' ? 'all' : 'real';
  try {
    const m = localStorage.getItem(KEY);
    return m === 'all' || m === 'real' ? m : fallback;
  } catch { return fallback; }
}

export function setMode(m: Mode) {
  try { localStorage.setItem(KEY, m); } catch { /* storage blocked: still works this session */ }
  window.dispatchEvent(new CustomEvent<Mode>(EVENT, { detail: m }));
}

/** Current mode; every component using it updates when the Dev tools switch flips. */
export function useMode(): Mode {
  const [mode, set] = useState<Mode>(read);
  useEffect(() => {
    const on = (e: Event) => set((e as CustomEvent<Mode>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return mode;
}

/** A report from a real phone, not the victim-sim page, injected load or a fake household. */
export const isRealReport = (r: { platform: string }) => r.platform !== 'sim' && r.platform !== 'synthetic';
