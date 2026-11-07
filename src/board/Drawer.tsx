// Case detail drawer (SPEC §6, issue #8), "dispatch console" look.
// Display only: no business logic. State and counts come straight from the request row.
// Usage: {selected && <Drawer key={String(selected.id)} request={selected} onClose={...} />}
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import type { Infer } from 'spacetimedb';
import { tables } from '../module_bindings';
import RequestRow from '../module_bindings/request_table';
import './Drawer.css';

type Request = Infer<typeof RequestRow>;

/** Shape the bridge's Claude extraction writes into `request.facts`. Every field may be missing. */
type Facts = {
  age: number | null;
  medical: string[];
  hazards: string[];
  people: number | null;
  location: string | null;
  quotes: string[];
};

type Tone = 'ok' | 'bad' | 'muted' | 'pending';

type HistoryItem = {
  key: string;
  atMicros: bigint;
  icon: string;
  title: string;
  status: string;
  tone: Tone;
  detail: string;
};

const STATE_LABEL: Record<string, string> = {
  new: 'NEW',
  waiting: 'WAITING',
  checkin_text_sent: 'CHECK-IN TEXT SENT',
  call_placed: 'CALLING',
  flagged: 'NEEDS WELFARE CHECK',
  claimed: 'CLAIMED',
  closed: 'CLOSED',
};

const KIND_LABEL: Record<string, { icon: string; title: string }> = {
  extract_facts: { icon: '◇', title: 'Read message' },
  send_text: { icon: '✉', title: 'Check-in text' },
  place_call: { icon: '☎', title: 'Call queued' },
};

const OUTBOX_TONE: Record<string, Tone> = { done: 'ok', failed: 'bad', cancelled: 'muted' };

const CALL_RESULT: Record<string, { label: string; tone: Tone }> = {
  placing: { label: 'Dialing', tone: 'pending' },
  ringing: { label: 'Ringing', tone: 'pending' },
  answered: { label: 'Answered', tone: 'ok' },
  no_answer: { label: 'No answer', tone: 'bad' },
  busy: { label: 'Busy', tone: 'bad' },
  failed: { label: 'Failed', tone: 'bad' },
};

const DTMF_LABEL: Record<string, string> = {
  '1': 'Pressed 1: still needs help',
  '2': 'Pressed 2: OK now',
};

function parseJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];

function parseFacts(json: string): Facts {
  const raw = parseJson<Record<string, unknown> | null>(json, null) ?? {};
  return {
    age: typeof raw.age === 'number' ? raw.age : null,
    medical: strings(raw.medical),
    hazards: strings(raw.hazards),
    people: typeof raw.people === 'number' ? raw.people : null,
    location: typeof raw.location === 'string' && raw.location ? raw.location : null,
    quotes: strings(raw.quotes),
  };
}

const msOf = (micros: bigint) => Number(micros / 1000n);
const clock = (micros: bigint) =>
  new Date(msOf(micros)).toLocaleTimeString([], { hour12: false });

function mmss(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function outboxDetail(kind: string, payload: string): string {
  const p = parseJson<Record<string, unknown>>(payload, {});
  if (kind === 'send_text' && typeof p.text === 'string') return `“${p.text}”`;
  if (typeof p.to === 'string' && p.to) return `→ ${p.to}`;
  return '';
}

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Score that counts up/down to its new value, like a readout. Own component so only it re-renders per frame. */
function Score({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reducedMotion() || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      const v = Math.round(a + (value - a) * (1 - (1 - k) ** 3));
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="dc-score__n">{String(shown).padStart(3, '0')}</span>;
}

/** Live "open mm:ss" timer; ticks on its own so the drawer doesn't re-render every second. */
function OpenFor({ since }: { since: bigint }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="dc-mono">{mmss(now - msOf(since))}</span>;
}

/** Text → Call → Welfare check, read from the row's state and counters. */
function Ladder({ r }: { r: Request }) {
  const stopped = r.state === 'claimed' || r.state === 'closed';
  const steps = [
    { label: 'Text', icon: '✉', done: r.checkinsSent > 0, active: r.state === 'checkin_text_sent' },
    { label: 'Call', icon: '☎', done: r.callsPlaced > 0, active: r.state === 'call_placed' },
    { label: 'Welfare check', icon: '⚑', done: r.state === 'flagged', active: r.state === 'flagged', alert: true },
  ];
  const caption = stopped
    ? r.state === 'claimed'
      ? 'Check-ins stopped: a responder has this case'
      : 'Case closed'
    : r.state === 'flagged'
      ? 'No answer to text or call. Send someone.'
      : r.state === 'call_placed'
        ? 'Calling now. Flags red if nobody answers.'
        : r.state === 'checkin_text_sent'
          ? 'Waiting for a reply. Calls next.'
          : 'Watching. Texts if nobody claims this.';

  return (
    <div className={`dc-ladder${stopped ? ' is-stopped' : ''}`}>
      <ol>
        {steps.map((s, i) => {
          const cls = [
            'dc-step',
            s.done && 'is-done',
            s.active && !stopped && 'is-active',
            s.alert && s.done && 'is-alert',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <li key={s.label} className={cls}>
              {i > 0 && <span className="dc-step__wire" aria-hidden />}
              <span className="dc-step__node" aria-hidden>{s.icon}</span>
              <span className="dc-step__label">{s.label}</span>
              <span className="dc-sr">{s.done ? ' (done)' : s.active ? ' (in progress)' : ' (not yet)'}</span>
            </li>
          );
        })}
      </ol>
      <p className="dc-ladder__caption">{caption}</p>
    </div>
  );
}

export default function Drawer({ request: r, onClose }: { request: Request; onClose: () => void }) {
  // Subscribe only to this case's rows, not the whole outbox/call tables.
  const [outbox, outboxReady] = useTable(tables.outbox.where((o) => o.requestId.eq(r.id)));
  const [calls, callsReady] = useTable(tables.call.where((c) => c.requestId.eq(r.id)));
  const ready = outboxReady && callsReady;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const facts = useMemo(() => parseFacts(r.facts), [r.facts]);
  const reasons = useMemo(() => strings(parseJson<unknown>(r.reasons, [])), [r.reasons]);

  const history = useMemo(() => {
    const items: HistoryItem[] = [
      ...outbox
        .filter((o) => o.requestId === r.id)
        .map((o) => {
          const k = KIND_LABEL[o.kind] ?? { icon: '•', title: o.kind.replace(/_/g, ' ') };
          return {
            key: `o${o.id.toString()}`,
            atMicros: o.createdAt.microsSinceUnixEpoch,
            icon: k.icon,
            title: k.title,
            status: o.status,
            tone: OUTBOX_TONE[o.status] ?? 'pending',
            detail: outboxDetail(o.kind, o.payload),
          };
        }),
      ...calls
        .filter((c) => c.requestId === r.id)
        .map((c) => {
          const res = CALL_RESULT[c.result] ?? { label: c.result, tone: 'pending' as Tone };
          return {
            key: `c${c.id.toString()}`,
            atMicros: c.createdAt.microsSinceUnixEpoch,
            icon: '☎',
            title: 'Check-in call',
            status: res.label,
            tone: res.tone,
            detail: DTMF_LABEL[c.dtmf] ?? (c.dtmf ? `Pressed ${c.dtmf}` : ''),
          };
        }),
    ];
    // Newest first (items is already a fresh array; useTable rows are readonly).
    return items.sort((a, b) => (a.atMicros < b.atMicros ? 1 : a.atMicros > b.atMicros ? -1 : 0));
  }, [outbox, calls, r.id]);

  // Entries already there when the drawer opened just fade in; ones that arrive later get a highlight.
  const initial = useRef<{ id: bigint; keys: Set<string> } | null>(null);
  if (ready && initial.current?.id !== r.id) {
    initial.current = { id: r.id, keys: new Set(history.map((h) => h.key)) };
  }
  const isFresh = (key: string) => !!initial.current && !initial.current.keys.has(key);

  const readouts: [string, string][] = [];
  if (facts.age != null) readouts.push(['AGE', String(facts.age)]);
  if (facts.people != null) readouts.push(['PEOPLE', String(facts.people)]);
  if (facts.location) readouts.push(['LOCATION', facts.location]);
  const hasFacts =
    readouts.length > 0 || facts.medical.length > 0 || facts.hazards.length > 0 || facts.quotes.length > 0;

  return (
    <aside
      className={`dc-drawer state-${r.state} tier-${r.tier}`}
      role="dialog"
      aria-label={`Case ${r.id.toString()} details`}
    >
      <div className="dc-scan" aria-hidden />

      <header className="dc-head">
        <div className="dc-head__row">
          <span className="dc-label">CASE</span>
          <span className="dc-casenum">#{r.id.toString().padStart(4, '0')}</span>
          <span className="dc-spacer" />
          <button className="dc-close" onClick={onClose} aria-label="Close case details">
            <span aria-hidden>✕</span> CLOSE <kbd>ESC</kbd>
          </button>
        </div>
        <div className="dc-head__row">
          <span className={`dc-tier tier-${r.tier}`}>{r.tier}</span>
          <span className="dc-state" key={r.state}>
            <span className="dc-state__dot" aria-hidden />
            {STATE_LABEL[r.state] ?? r.state.toUpperCase()}
          </span>
          <span className="dc-spacer" />
          <span className="dc-score" title={`base ${r.baseScore} + escalation ${r.escalation}`}>
            <span className="dc-label">SCORE</span>
            <Score value={r.score} />
          </span>
        </div>
        <div className="dc-head__meta dc-mono">
          {r.platform.toUpperCase()} · {r.victimHandle} · IN {clock(r.createdAt.microsSinceUnixEpoch)} · OPEN{' '}
          <OpenFor since={r.createdAt.microsSinceUnixEpoch} />
        </div>
      </header>

      <Ladder r={r} />

      <section className="dc-panel">
        <h3 className="dc-label">Incoming message</h3>
        <p className="dc-raw">{r.rawText}</p>
      </section>

      <section className="dc-panel">
        <h3 className="dc-label">
          Facts {r.factsStatus !== 'done' && <span className="dc-muted">[{r.factsStatus}]</span>}
        </h3>
        {readouts.length > 0 && (
          <dl className="dc-readouts">
            {readouts.map(([k, v]) => (
              <div key={k}>
                <dt className="dc-label">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {facts.medical.length > 0 && (
          <TagRow label="MEDICAL" items={facts.medical} cls="is-medical" />
        )}
        {facts.hazards.length > 0 && (
          <TagRow label="HAZARDS" items={facts.hazards} cls="is-hazard" />
        )}
        {facts.quotes.length > 0 && (
          <div className="dc-quotes">
            <span className="dc-label">IN THEIR WORDS</span>
            {facts.quotes.map((q, i) => (
              <blockquote key={i}>{q}</blockquote>
            ))}
          </div>
        )}
        {!hasFacts && <p className="dc-muted">No facts extracted yet.</p>}
      </section>

      <section className="dc-panel">
        <h3 className="dc-label">Why this score</h3>
        <p className="dc-mono dc-formula">
          {r.baseScore} <span className="dc-muted">base</span> + {r.escalation}{' '}
          <span className="dc-muted">escalation</span> = <b>{r.score}</b>
        </p>
        {reasons.length > 0 && (
          <div className="dc-reasons">
            {reasons.map((x, i) => (
              <span key={i} className="dc-reason">{x}</span>
            ))}
          </div>
        )}
      </section>

      <section className="dc-panel">
        <h3 className="dc-label">
          Check-in log{' '}
          <span className="dc-muted">
            {r.checkinsSent} TXT · {r.callsPlaced} CALL
          </span>
        </h3>
        {!ready && <p className="dc-muted dc-blink">Loading…</p>}
        {ready && history.length === 0 && <p className="dc-muted">Nothing sent yet.</p>}
        <ol className="dc-log">
          {history.map((h, i) => (
            <li
              key={h.key}
              className={`dc-log__item tone-${h.tone}${isFresh(h.key) ? ' is-fresh' : ''}`}
              style={{ animationDelay: isFresh(h.key) ? '0ms' : `${Math.min(i, 8) * 45}ms` }}
            >
              <time className="dc-mono">{clock(h.atMicros)}</time>
              <span className="dc-log__icon" aria-hidden>{h.icon}</span>
              <div className="dc-log__body">
                <div className="dc-log__head">
                  <b>{h.title}</b>
                  <span className="dc-pill">{h.status}</span>
                </div>
                {h.detail && <div className="dc-log__detail">{h.detail}</div>}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}

function TagRow({ label, items, cls }: { label: string; items: string[]; cls: string }) {
  return (
    <div className="dc-tagrow">
      <span className="dc-label">{label}</span>
      <div className="dc-tags">
        {items.map((x, i) => (
          <span key={i} className={`dc-tag ${cls}`}>{x}</span>
        ))}
      </div>
    </div>
  );
}
