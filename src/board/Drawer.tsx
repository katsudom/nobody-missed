// Case detail drawer (SPEC §6, issue #8). Display only: no business logic.
// Usage: {selected && <Drawer request={selected} onClose={() => setSelected(null)} />}
import { useEffect, useMemo } from 'react';
import { useTable } from 'spacetimedb/react';
import type { Infer } from 'spacetimedb';
import { tables } from '../module_bindings';
import RequestRow from '../module_bindings/request_table';
import './Drawer.css';

type Request = Infer<typeof RequestRow>;

/** Shape the bridge's Claude extraction writes into `request.facts`. Every field may be missing. */
type Facts = {
  age?: number | null;
  medical?: string[];
  hazards?: string[];
  people?: number | null;
  location?: string | null;
  quotes?: string[];
};

type HistoryItem = {
  key: string;
  atMicros: bigint;
  title: string;
  status: string;
  detail: string;
};

const STATE_LABEL: Record<string, string> = {
  new: 'New',
  waiting: 'Waiting',
  checkin_text_sent: 'Check-in text sent',
  call_placed: 'Call placed',
  flagged: 'Needs welfare check',
  claimed: 'Claimed',
  closed: 'Closed',
};

const KIND_LABEL: Record<string, string> = {
  extract_facts: 'Read the message',
  send_text: 'Check-in text',
  place_call: 'Check-in call queued',
};

const CALL_RESULT_LABEL: Record<string, string> = {
  placing: 'Dialing',
  ringing: 'Ringing',
  answered: 'Answered',
  no_answer: 'No answer',
  busy: 'Busy',
  failed: 'Failed',
};

const DTMF_LABEL: Record<string, string> = {
  '1': 'pressed 1 (still needs help)',
  '2': 'pressed 2 (OK now)',
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
  const raw = parseJson<Record<string, unknown>>(json, {});
  if (!raw || typeof raw !== 'object') return {};
  return {
    age: typeof raw.age === 'number' ? raw.age : null,
    medical: strings(raw.medical),
    hazards: strings(raw.hazards),
    people: typeof raw.people === 'number' ? raw.people : null,
    location: typeof raw.location === 'string' && raw.location ? raw.location : null,
    quotes: strings(raw.quotes),
  };
}

const timeOf = (micros: bigint) => new Date(Number(micros / 1000n)).toLocaleTimeString();

function outboxDetail(kind: string, payload: string): string {
  const p = parseJson<Record<string, unknown>>(payload, {});
  if (kind === 'send_text' && typeof p.text === 'string') return `“${p.text}”`;
  if (typeof p.to === 'string' && p.to) return `to ${p.to}`;
  return '';
}

export default function Drawer({ request: r, onClose }: { request: Request; onClose: () => void }) {
  // Subscribe only to this case's rows, not the whole outbox/call tables.
  const [outbox, outboxReady] = useTable(tables.outbox.where((o) => o.requestId.eq(r.id)));
  const [calls, callsReady] = useTable(tables.call.where((c) => c.requestId.eq(r.id)));

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
        .map((o) => ({
          key: `o${o.id.toString()}`,
          atMicros: o.createdAt.microsSinceUnixEpoch,
          title: KIND_LABEL[o.kind] ?? o.kind.replace(/_/g, ' '),
          status: o.status,
          detail: outboxDetail(o.kind, o.payload),
        })),
      ...calls
        .filter((c) => c.requestId === r.id)
        .map((c) => ({
          key: `c${c.id.toString()}`,
          atMicros: c.createdAt.microsSinceUnixEpoch,
          title: 'Check-in call',
          status: CALL_RESULT_LABEL[c.result] ?? c.result,
          detail: DTMF_LABEL[c.dtmf] ?? (c.dtmf ? `pressed ${c.dtmf}` : ''),
        })),
    ];
    // Newest first. Copy already made above; rows from useTable are readonly.
    return items.sort((a, b) => (a.atMicros < b.atMicros ? 1 : a.atMicros > b.atMicros ? -1 : 0));
  }, [outbox, calls, r.id]);

  const factRows: [string, string][] = [];
  if (facts.age != null) factRows.push(['Age', String(facts.age)]);
  if (facts.people != null) factRows.push(['People', String(facts.people)]);
  if (facts.location) factRows.push(['Location', facts.location]);

  return (
    <aside className="case-drawer" role="dialog" aria-label={`Case ${r.id.toString()} details`}>
      <header className="case-drawer__head">
        <div>
          <h2>Case #{r.id.toString()}</h2>
          <div className="case-drawer__chips">
            <span className={`case-drawer__tier tier-${r.tier}`}>{r.tier}</span>
            <span className={`case-drawer__state state-${r.state}`}>{STATE_LABEL[r.state] ?? r.state}</span>
            <span className="case-drawer__score">score {r.score}</span>
          </div>
        </div>
        <button className="case-drawer__close" onClick={onClose} aria-label="Close case details">
          Close
        </button>
      </header>

      <section>
        <h3>Message</h3>
        <p className="case-drawer__raw">{r.rawText}</p>
        <p className="case-drawer__meta">
          {r.platform} · {r.victimHandle} · received {timeOf(r.createdAt.microsSinceUnixEpoch)}
        </p>
      </section>

      <section>
        <h3>Facts {r.factsStatus !== 'done' && <span className="case-drawer__muted">({r.factsStatus})</span>}</h3>
        {factRows.length > 0 && (
          <dl className="case-drawer__facts">
            {factRows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <FactList label="Medical" items={facts.medical ?? []} />
        <FactList label="Hazards" items={facts.hazards ?? []} />
        {(facts.quotes ?? []).length > 0 && (
          <div className="case-drawer__group">
            <h4>In their words</h4>
            {facts.quotes!.map((q, i) => (
              <blockquote key={i}>“{q}”</blockquote>
            ))}
          </div>
        )}
        {factRows.length === 0 &&
          !facts.medical?.length &&
          !facts.hazards?.length &&
          !facts.quotes?.length && <p className="case-drawer__muted">No facts extracted yet.</p>}
      </section>

      <section>
        <h3>Why this score</h3>
        <p className="case-drawer__meta">
          base {r.baseScore} + escalation {r.escalation} = {r.score}
        </p>
        {reasons.length > 0 && (
          <div className="case-drawer__chips">
            {reasons.map((x, i) => (
              <span key={i} className="case-drawer__reason">{x}</span>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3>
          Check-in history{' '}
          <span className="case-drawer__muted">
            ({r.checkinsSent} texts · {r.callsPlaced} calls)
          </span>
        </h3>
        {!(outboxReady && callsReady) && <p className="case-drawer__muted">Loading…</p>}
        {outboxReady && callsReady && history.length === 0 && (
          <p className="case-drawer__muted">Nothing sent yet.</p>
        )}
        <ol className="case-drawer__history">
          {history.map((h) => (
            <li key={h.key}>
              <div className="case-drawer__histhead">
                <time>{timeOf(h.atMicros)}</time>
                <b>{h.title}</b>
                <span className={`case-drawer__status status-${h.status.replace(/\s+/g, '_').toLowerCase()}`}>
                  {h.status}
                </span>
              </div>
              {h.detail && <div className="case-drawer__detail">{h.detail}</div>}
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}

function FactList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="case-drawer__group">
      <h4>{label}</h4>
      <ul>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
