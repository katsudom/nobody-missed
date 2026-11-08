import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSpacetimeDB } from 'spacetimedb/react';
import type { DbConnection } from './module_bindings';

// ---------- Toasts ----------
type Toast = { id: number; text: string; ok: boolean };
const ToastCtx = createContext<(text: string, ok?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, ok = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, ok }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.ok ? 'ok' : ''}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Reducer calls: failures become toasts ----------
export function useConn() {
  const { getConnection } = useSpacetimeDB();
  return getConnection() as DbConnection | null;
}

export function useRun() {
  const conn = useConn();
  const toast = useToast();
  return useCallback(
    (fn: (c: DbConnection) => Promise<unknown>) => {
      if (!conn) {
        toast('Not connected yet');
        return Promise.resolve(false);
      }
      return fn(conn).then(
        () => true,
        (e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          toast(msg.replace(/^.*?(already (?:claimed|taken) by)/i, '$1'));
          return false;
        }
      );
    },
    [conn, toast]
  );
}

// ---------- Time ----------
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export const tsMs = (t: { microsSinceUnixEpoch: bigint }) => Number(t.microsSinceUnixEpoch / 1000n);

export function mmss(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- JSON helpers ----------
export function parseJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function parseQuotes(factsJson: string): string[] {
  const f = parseJson<{ quotes?: unknown }>(factsJson, {});
  return Array.isArray(f.quotes) ? f.quotes.filter((q): q is string => typeof q === 'string' && q.length > 0) : [];
}

export function parseReasons(reasonsJson: string): string[] {
  const r = parseJson<unknown>(reasonsJson, []);
  return Array.isArray(r) ? r.map(String) : [];
}

// ---------- Highlighted text ----------
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function Highlighted({ text, quotes }: { text: string; quotes: string[] }) {
  if (quotes.length === 0) return <>{text}</>;
  const re = new RegExp(`(${quotes.map(escapeRe).join('|')})`, 'gi');
  const lower = quotes.map((q) => q.toLowerCase());
  return (
    <>
      {text.split(re).map((part, i) =>
        lower.includes(part.toLowerCase()) ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>
      )}
    </>
  );
}

// ---------- Priority levels (spacetimedb/src/rules.ts levelFor) ----------
// A report's `tier` column holds its level. Responders see P1 / P2 / P3, never the points.
export const LEVEL: Record<string, { label: string; name: string; rank: number }> = {
  critical: { label: 'P1', name: 'Go now', rank: 1 },
  high: { label: 'P2', name: 'Go soon', rank: 2 },
  normal: { label: 'P3', name: 'Check when you can', rank: 3 },
};
export const levelOf = (tier: string) => LEVEL[tier] ?? LEVEL.normal;

/** Level first, then whoever has waited longest. */
export function byLevel(a: { tier: string; createdAt: { microsSinceUnixEpoch: bigint } }, b: { tier: string; createdAt: { microsSinceUnixEpoch: bigint } }) {
  return levelOf(a.tier).rank - levelOf(b.tier).rank ||
    (a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? -1 : a.createdAt.microsSinceUnixEpoch > b.createdAt.microsSinceUnixEpoch ? 1 : 0);
}

export function Level({ tier }: { tier: string }) {
  const l = levelOf(tier);
  return <span className={`lvl lvl-${tier in LEVEL ? tier : 'normal'}`} title={l.name}>{l.label}</span>;
}
