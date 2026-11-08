// Responder board, "triage inbox" layout (SPEC §6): a slim ranked list on the left, the selected
// case on the right with one clear action. Display only: ranking, state and escalation come from the module.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import DevTools from './DevTools';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import type { Infer } from 'spacetimedb';
import RequestRow from './module_bindings/request_table';
import { Highlighted, mmss, parseQuotes, parseReasons, tsMs, useNow, useRun, useToast } from './lib';
import { personFor } from './policyholders';
import ImpactMap from './ImpactMap';
import { CaseFacts, CheckinLog, EscalationLadder } from './board/Drawer';

type Request = Infer<typeof RequestRow>;
const MAX_ROWS = 200;

type Cat = 'help' | 'waiting' | 'silent' | 'claimed' | 'safe';
type Filter = 'open' | Cat;

const CATS: { key: Cat; label: string; color: string }[] = [
  { key: 'silent', label: 'Welfare check', color: 'var(--red)' },
  { key: 'waiting', label: 'Waiting on reply', color: 'var(--amber)' },
  { key: 'help', label: 'Needs help', color: 'var(--orange)' },
  { key: 'claimed', label: 'Claimed', color: 'var(--blue)' },
  { key: 'safe', label: 'Safe', color: 'var(--green)' },
];
const CAT_COLOR = Object.fromEntries(CATS.map((c) => [c.key, c.color])) as Record<Cat, string>;

function catOf(r: Request): Cat {
  if (r.state === 'closed') return 'safe';
  if (r.claimedBy) return 'claimed';
  if (r.state === 'flagged') return 'silent';
  if (r.state === 'checkin_text_sent' || r.state === 'call_placed') return 'waiting';
  return 'help';
}

const STATE_LABEL: Record<string, string> = {
  new: 'Needs help',
  waiting: 'Needs help',
  checkin_text_sent: 'Check-in text sent',
  call_placed: 'Calling',
  flagged: 'Needs welfare check',
  claimed: 'Claimed',
  closed: 'Safe',
};

function compare(a: Request, b: Request) {
  return (
    b.score - a.score ||
    b.baseScore - a.baseScore ||
    (a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? -1 : 1)
  );
}

/** "12m", "1h 05m": short enough for a list row. */
function ago(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

// ---------- Queue row: one case, two lines, no buttons ----------
type RowProps = {
  r: Request;
  now: number;
  claimer: string;
  fresh: boolean;
  selected: boolean;
  onOpen: (id: bigint) => void;
};

const Row = memo(function Row({ r, now, claimer, fresh, selected, onOpen }: RowProps) {
  const person = useMemo(() => personFor(r), [r.id, r.victimHandle, r.rawText]); // eslint-disable-line react-hooks/exhaustive-deps
  const cat = catOf(r);
  const status =
    cat === 'claimed' ? `${claimer} on it`
    : cat === 'safe' ? 'Safe'
    : cat === 'silent' ? 'Welfare check'
    : cat === 'waiting' ? (r.state === 'call_placed' ? 'Calling' : 'Texted')
    : ago(now - tsMs(r.createdAt));

  return (
    <li>
      <button
        type="button"
        className={`irow cat-${cat}${selected ? ' is-selected' : ''}${fresh ? ' is-fresh' : ''}`}
        aria-current={selected ? 'true' : undefined}
        data-id={r.id.toString()}
        onClick={() => onOpen(r.id)}
      >
        <span className="irow__dot" style={{ background: CAT_COLOR[cat] }} aria-hidden />
        <span className="irow__main">
          <span className="irow__top">
            <span className="irow__name">{person.name}</span>
            <span className="irow__issue">{person.issue}</span>
          </span>
          <span className="irow__msg">{r.rawText}</span>
        </span>
        <span className="irow__side">
          <span className={`irow__score tier-${r.tier}`}>{r.score}</span>
          <span className={`irow__status s-${cat}`}>{status}</span>
        </span>
      </button>
    </li>
  );
});

// ---------- Board ----------
export default function Board() {
  const { identity } = useSpacetimeDB();
  const run = useRun();
  const toast = useToast();
  const now = useNow();
  const [requests, ready] = useTable(tables.request);
  const [responders] = useTable(tables.responder);
  const [selected, setSelected] = useState<bigint | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of responders) m.set(x.identity.toHexString(), x.name);
    return m;
  }, [responders]);

  const { top, counts, total, open } = useMemo(() => {
    const c: Record<Cat, number> = { help: 0, waiting: 0, silent: 0, claimed: 0, safe: 0 };
    const shown: Request[] = [];
    for (const r of requests) {
      const k = catOf(r);
      c[k]++;
      if (filter === k || (filter === 'open' && k !== 'safe')) shown.push(r);
    }
    return { top: shown.sort(compare).slice(0, MAX_ROWS), counts: c, total: requests.length, open: requests.length - c.safe };
  }, [requests, filter]);
  const shownTotal = filter === 'open' ? open : counts[filter];

  // Pulse only rows that arrive after the first full load.
  const seen = useRef<Set<string> | null>(null);
  const freshIds = new Set<string>();
  if (ready) {
    if (seen.current === null) seen.current = new Set(requests.map((r) => r.id.toString()));
    else for (const r of requests) {
      const k = r.id.toString();
      if (!seen.current.has(k)) { seen.current.add(k); freshIds.add(k); }
    }
  }

  // The panel shows the clicked case, or the top-ranked one until you click.
  const selectedReq =
    (selected !== null ? requests.find((r) => r.id === selected) : undefined) ?? top[0];

  // ↑ / ↓ (or k / j) move through the list. Read live values from a ref so fast repeats don't use stale state.
  const nav = useRef({ top, id: selectedReq?.id });
  nav.current = { top, id: selectedReq?.id };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const step = e.key === 'ArrowDown' || e.key === 'j' ? 1 : e.key === 'ArrowUp' || e.key === 'k' ? -1 : 0;
      const { top: list, id } = nav.current;
      if (!step || list.length === 0) return;
      e.preventDefault();
      const i = id === undefined ? -1 : list.findIndex((r) => r.id === id);
      const next = list[Math.min(list.length - 1, Math.max(0, i + step))];
      nav.current = { top: list, id: next.id };
      setSelected(next.id);
      listRef.current
        ?.querySelector(`[data-id="${next.id.toString()}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const me = identity?.toHexString();
  const onClaim = (id: bigint) => run((c) => c.reducers.claimRequest({ requestId: id }));
  const onRelease = (id: bigint) => run((c) => c.reducers.releaseRequest({ requestId: id }));
  const onResolve = (id: bigint) => run((c) => c.reducers.resolveRequest({ requestId: id }));
  const onInject = () => run((c) => c.reducers.injectLoad({ n: 2000 }));
  const doReset = async () => {
    setResetting(true);
    const ok = await run((c) => c.reducers.resetDemo({}));
    setResetting(false);
    setConfirmReset(false);
    if (ok) {
      setSelected(null);
      toast('Demo reset: all requests cleared for everyone', true);
    }
  };

  const dots = useMemo(
    () => top.map((r) => ({ id: r.id, color: CAT_COLOR[catOf(r)], big: r.tier === 'critical' })),
    [top]
  );
  const handled = total ? Math.round(((counts.claimed + counts.safe) / total) * 100) : 0;

  const tabs: { key: Filter; label: string; n: number; color?: string }[] = [
    { key: 'open', label: 'Open', n: open },
    ...CATS.map((c) => ({ key: c.key as Filter, label: c.label, n: counts[c.key], color: c.color })),
  ];

  return (
    <div className="inbox">
      <header className="ibar">
        <div className="ibar__brand">
          <span className="eyebrow">Nobody Missed</span>
          <h1>Check-in command center</h1>
        </div>
        <div className="ibar__progress" title={`${counts.claimed + counts.safe} of ${total} claimed or safe`}>
          <span className="ibar__pct">{handled}%</span>
          <span className="ibar__pctl">claimed or safe</span>
        </div>
        <span className="simtag">Simulated storm · synthetic policyholders</span>
      </header>

      <nav className="filters" aria-label="Filter cases">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`filter${filter === t.key ? ' is-on' : ''}${t.key === 'silent' && t.n > 0 ? ' is-alert' : ''}`}
            aria-pressed={filter === t.key}
            onClick={() => setFilter(t.key)}
          >
            {t.color && <span className="filter__dot" style={{ background: t.color }} aria-hidden />}
            {t.label}
            <span className="filter__n">{t.n.toLocaleString()}</span>
          </button>
        ))}
      </nav>

      <div className="ibody">
        <section className="ilist" aria-label="Ranked cases">
          <div className="ilist__head">
            <span>Most urgent first</span>
            <span className="ilist__keys"><kbd>↑</kbd><kbd>↓</kbd> to move</span>
          </div>
          {!ready && <p className="empty">Loading…</p>}
          {ready && top.length === 0 && <p className="empty">No cases here.</p>}
          <ol className="ilist__rows" ref={listRef}>
            {top.map((r) => {
              const hex = r.claimedBy?.toHexString();
              return (
                <Row
                  key={r.id.toString()}
                  r={r}
                  now={now}
                  claimer={hex ? (hex === me ? 'You' : names.get(hex) ?? 'A responder') : ''}
                  fresh={freshIds.has(r.id.toString())}
                  selected={selectedReq?.id === r.id}
                  onOpen={setSelected}
                />
              );
            })}
          </ol>
          {shownTotal > MAX_ROWS && <p className="empty">Showing the top {MAX_ROWS} of {shownTotal.toLocaleString()}.</p>}
        </section>

        <main className="icase">
          {selectedReq ? (
            <CasePanel
              r={selectedReq}
              now={now}
              mine={!!selectedReq.claimedBy && selectedReq.claimedBy.toHexString() === me}
              claimer={(() => {
                const hex = selectedReq.claimedBy?.toHexString();
                return hex ? (hex === me ? 'You' : names.get(hex) ?? 'A responder') : '';
              })()}
              dots={dots}
              onPick={setSelected}
              onClaim={onClaim}
              onRelease={onRelease}
              onResolve={onResolve}
            />
          ) : (
            <div className="icase__empty">
              <h2>{ready ? 'Nobody waiting' : 'Loading…'}</h2>
              {ready && <p className="meta">New messages show up on the left, most urgent first.</p>}
            </div>
          )}
        </main>
      </div>

      <DevTools onInject={onInject} onAskReset={() => setConfirmReset(true)} />

      {confirmReset && (
        <div className="modal" onClick={() => !resetting && setConfirmReset(false)}>
          <div className="modalbox" onClick={(e) => e.stopPropagation()}>
            <h2>Reset the demo?</h2>
            <p className="meta">
              This deletes every request, check-in and call in the SHARED database, for everyone on the team.
              Only continue if the whole team agreed.
            </p>
            <div className="actions">
              <button className="btn big" disabled={resetting} onClick={() => setConfirmReset(false)}>Cancel</button>
              <button className="btn big danger solid" disabled={resetting} onClick={doReset}>
                {resetting ? 'Resetting…' : 'Yes, reset for everyone'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Selected case ----------
function CasePanel({ r, now, mine, claimer, dots, onPick, onClaim, onRelease, onResolve }: {
  r: Request; now: number; mine: boolean; claimer: string;
  dots: { id: bigint; color: string; big: boolean }[];
  onPick: (id: bigint) => void;
  onClaim: (id: bigint) => void; onRelease: (id: bigint) => void; onResolve: (id: bigint) => void;
}) {
  const person = useMemo(() => personFor(r), [r.id, r.victimHandle, r.rawText]); // eslint-disable-line react-hooks/exhaustive-deps
  const reasons = parseReasons(r.reasons);
  const quotes = parseQuotes(r.facts);
  const claimed = !!r.claimedBy;
  const closed = r.state === 'closed';
  const cat = catOf(r);

  return (
    <article className={`case cat-${cat}`} aria-label={`Case: ${person.name}`}>
      <header className="case__head">
        <div className="case__who">
          <h2>{person.name}</h2>
          <div className="meta">
            {person.age ? `Age ${person.age} · ` : ''}{person.address ?? r.victimHandle}
            {person.policy && <> · {person.policy} policy</>}
          </div>
        </div>
        <div className="case__urgency">
          <span className={`case__score tier-${r.tier}`}>{r.score}</span>
          <span className="case__scorel">urgency</span>
        </div>
      </header>

      <div className="case__bar">
        <span className={`pill state-${r.state}`}>{STATE_LABEL[r.state] ?? r.state}</span>
        <span className="case__open meta">open {mmss(now - tsMs(r.createdAt))}</span>
        <span className="spacer" />
        {claimed && !closed && <span className="case__claimer">{claimer} {claimer === 'You' ? 'have' : 'has'} this case</span>}
        {!claimed && !closed && (
          <button className="btn big primary" onClick={() => onClaim(r.id)}>Claim this case</button>
        )}
        {mine && !closed && <button className="btn big" onClick={() => onRelease(r.id)}>Release</button>}
        {!closed && <button className="btn big" onClick={() => onResolve(r.id)}>Mark safe</button>}
      </div>

      <EscalationLadder r={r} />

      <div className="case__msg">
        <div className="bubble"><Highlighted text={r.rawText} quotes={quotes} /></div>
        <div className="stamp">{r.platform} · {r.victimHandle} · {new Date(tsMs(r.createdAt)).toLocaleTimeString()}</div>
      </div>

      <div className="case__grid">
        <section className="case__sec">
          <h3>Why it's ranked here</h3>
          <p className="case__why">
            {person.issue}. Base {r.baseScore} + {r.escalation} for waiting unclaimed = <b>{r.score}</b>.
          </p>
          {reasons.length > 0 && <div className="reasons">{reasons.map((x, i) => <span key={i} className="reason">{x}</span>)}</div>}
          <h3>Facts</h3>
          <CaseFacts r={r} />
        </section>

        <section className="case__sec">
          <h3>Check-ins · {r.checkinsSent} texts · {r.callsPlaced} calls</h3>
          <CheckinLog key={r.id.toString()} r={r} />
        </section>
      </div>

      <section className="case__sec case__map">
        <h3>Where <span className="meta">positions simulated</span></h3>
        <ImpactMap dots={dots} selectedId={r.id} onPick={onPick} />
      </section>
    </article>
  );
}
