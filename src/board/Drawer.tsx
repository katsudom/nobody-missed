// Case detail pieces for the board's side panel (SPEC §6, issue #8).
// Display only: no business logic. Everything is read from the request row and its outbox/call rows.
//   <EscalationLadder r={r} />            Text → Call → Welfare check
//   <CaseFacts r={r} />                   age / people / location / medical / hazards, readable
//   <CheckinLog key={String(r.id)} r={r} /> outbox + call rows for this case, newest first
import { useMemo, useRef } from 'react';
import { useTable } from 'spacetimedb/react';
import type { Infer } from 'spacetimedb';
import { tables } from '../module_bindings';
import RequestRow from '../module_bindings/request_table';
import { maskHandle } from '../policyholders';
import './Drawer.css';

type Request = Infer<typeof RequestRow>;
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

const clock = (micros: bigint) =>
  new Date(Number(micros / 1000n)).toLocaleTimeString([], { hour12: false });

function outboxDetail(kind: string, payload: string): string {
  const p = parseJson<Record<string, unknown>>(payload, {});
  if (kind === 'send_text' && typeof p.text === 'string') return `“${p.text}”`;
  if (typeof p.to === 'string' && p.to) return `→ ${p.platform === 'sim' || p.platform === 'synthetic' ? p.to : maskHandle(p.to)}`;
  return '';
}

// ---------- Escalation ladder ----------
export function EscalationLadder({ r }: { r: Request }) {
  const stopped = r.state === 'claimed' || r.state === 'closed' || !!r.claimedBy;
  const steps = [
    { label: 'Text', icon: '✉', done: r.checkinsSent > 0, active: r.state === 'checkin_text_sent' },
    { label: 'Call', icon: '☎', done: r.callsPlaced > 0, active: r.state === 'call_placed' },
    { label: 'Welfare check', icon: '⚑', done: r.state === 'flagged', active: r.state === 'flagged', alert: true },
  ];
  const caption = stopped
    ? r.state === 'closed'
      ? 'Safe. Case closed.'
      : 'Check-ins stopped: a responder has this case.'
    : r.state === 'flagged'
      ? 'No answer to text or call. Send someone.'
      : r.state === 'call_placed'
        ? 'Calling now. Turns red if nobody answers.'
        : r.state === 'checkin_text_sent'
          ? 'Waiting for a reply. Calls next.'
          : 'Watching. Texts them if nobody claims this.';

  return (
    <div className={`dc-ladder${stopped ? ' is-stopped' : ''}${r.state === 'flagged' ? ' is-flagged' : ''}`}>
      <ol>
        {steps.map((s, i) => {
          const cls = ['dc-step', s.done && 'is-done', s.active && !stopped && 'is-active', s.alert && s.done && 'is-alert']
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

// ---------- Facts ----------
export function CaseFacts({ r }: { r: Request }) {
  const f = useMemo(() => parseJson<Record<string, unknown> | null>(r.facts, null) ?? {}, [r.facts]);
  const readouts: [string, string][] = [];
  if (typeof f.age === 'number') readouts.push(['Age', String(f.age)]);
  if (typeof f.people === 'number') readouts.push(['People', String(f.people)]);
  if (typeof f.location === 'string' && f.location) readouts.push(['Location', f.location]);
  const medical = strings(f.medical);
  const hazards = strings(f.hazards);

  if (readouts.length === 0 && medical.length === 0 && hazards.length === 0) {
    return (
      <p className="dc-muted">
        {r.factsStatus === 'pending' ? 'Reading the message…' : 'No facts extracted.'}
      </p>
    );
  }
  return (
    <div className="dc-facts">
      {readouts.length > 0 && (
        <dl className="dc-readouts">
          {readouts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {(medical.length > 0 || hazards.length > 0) && (
        <div className="dc-tags">
          {medical.map((x, i) => (
            <span key={`m${i}`} className="dc-tag is-medical">✚ {x}</span>
          ))}
          {hazards.map((x, i) => (
            <span key={`h${i}`} className="dc-tag is-hazard">⚠ {x}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Check-in log ----------
export function CheckinLog({ r }: { r: Request }) {
  // Subscribe only to this case's rows, not the whole outbox/call tables.
  const [outbox, outboxReady] = useTable(tables.outbox.where((o) => o.requestId.eq(r.id)));
  const [calls, callsReady] = useTable(tables.call.where((c) => c.requestId.eq(r.id)));
  const ready = outboxReady && callsReady;

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
    // Newest first (items is a fresh array; useTable rows are readonly).
    return items.sort((a, b) => (a.atMicros < b.atMicros ? 1 : a.atMicros > b.atMicros ? -1 : 0));
  }, [outbox, calls, r.id]);

  // Entries already there when the case opened just fade in; ones that arrive later get a highlight.
  const initial = useRef<{ id: bigint; keys: Set<string> } | null>(null);
  if (ready && initial.current?.id !== r.id) {
    initial.current = { id: r.id, keys: new Set(history.map((h) => h.key)) };
  }
  const isFresh = (key: string) => !!initial.current && !initial.current.keys.has(key);

  if (!ready) return <p className="dc-muted">Loading…</p>;
  if (history.length === 0) return <p className="dc-muted">Nothing sent yet.</p>;
  return (
    <ol className="dc-log">
      {history.map((h, i) => (
        <li
          key={h.key}
          className={`dc-log__item tone-${h.tone}${isFresh(h.key) ? ' is-fresh' : ''}`}
          style={{ animationDelay: isFresh(h.key) ? '0ms' : `${Math.min(i, 8) * 45}ms` }}
        >
          <time>{clock(h.atMicros)}</time>
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
  );
}
