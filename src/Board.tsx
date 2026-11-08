import { memo, useMemo, useRef, useState } from 'react';
import DevTools from './DevTools';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import type { Infer } from 'spacetimedb';
import RequestRow from './module_bindings/request_table';
import HouseholdRow from './module_bindings/household_table';
import {
  Highlighted, mmss, parseQuotes, parseReasons, tsMs, useNow, useRun, useToast,
} from './lib';
import { personFor } from './policyholders';
import { CaseFacts, CheckinLog, EscalationLadder } from './board/Drawer';

type Request = Infer<typeof RequestRow>;
type Household = Infer<typeof HouseholdRow>;
const MAX_ROWS = 200;

type Cat = 'help' | 'waiting' | 'silent' | 'claimed' | 'safe';
const CATS: { key: Cat; label: string; color: string }[] = [
  { key: 'help', label: 'Needs help', color: 'var(--red)' },
  { key: 'waiting', label: 'Waiting', color: 'var(--amber)' },
  { key: 'silent', label: 'Silent', color: 'var(--grey)' },
  { key: 'claimed', label: 'Claimed', color: 'var(--blue)' },
  { key: 'safe', label: 'Safe', color: 'var(--green)' },
];

function catOf(r: Request): Cat {
  if (r.state === 'closed') return 'safe';
  if (r.state === 'flagged') return 'silent';
  if (r.claimedBy) return 'claimed';
  if (r.state === 'checkin_text_sent' || r.state === 'call_placed') return 'waiting';
  return 'help';
}

const STATE_LABEL: Record<string, string> = {
  new: 'Needs help',
  waiting: 'Needs help',
  checkin_text_sent: 'Text sent',
  call_placed: 'Call placed',
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

type RowProps = {
  r: Request;
  household?: Household;
  now: number;
  mine: boolean;
  claimer: string;
  fresh: boolean;
  selected: boolean;
  onOpen: (id: bigint) => void;
  onClaim: (id: bigint) => void;
  onRelease: (id: bigint) => void;
  onResolve: (id: bigint) => void;
};

const Row = memo(function Row({ r, household, now, mine, claimer, fresh, selected, onOpen, onClaim, onRelease, onResolve }: RowProps) {
  const quotes = useMemo(() => parseQuotes(r.facts), [r.facts]);
  const reasons = useMemo(() => parseReasons(r.reasons), [r.reasons]);
  const person = useMemo(() => personFor(r, household), [r.id, r.victimHandle, r.rawText, household]); // eslint-disable-line react-hooks/exhaustive-deps
  const claimed = !!r.claimedBy;
  const stop = (fn: (id: bigint) => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn(r.id);
  };
  const timer = claimed ? '' : `unclaimed ${mmss(now - tsMs(r.createdAt))}`;

  return (
    <div
      className={`row ${r.state === 'flagged' ? 'flagged' : ''} ${selected ? 'selected' : ''} ${fresh ? 'pulse' : ''}`}
      onClick={() => onOpen(r.id)}
    >
      <span className={`pill state-${r.state}`}>{STATE_LABEL[r.state] ?? r.state}</span>
      <div className="main">
        <div className="name">{person.name}</div>
        <div className="text"><Highlighted text={r.rawText} quotes={quotes} /></div>
        <div className="sub">
          <span className="issue">{person.issue}</span>
          {reasons.map((x, i) => <span key={i} className="reason">{x}</span>)}
        </div>
      </div>
      <span className="timer">{timer}</span>
      <div className={`bar tier-${r.tier}`}><i style={{ width: `${Math.min(100, r.score)}%` }} /></div>
      <span className={`score tier-${r.tier}`}>{r.score}</span>
      <div className="actions">
        {claimed && <span className="onway">{claimer} is on the way</span>}
        {!claimed && r.state !== 'closed' && <button className="btn outline" onClick={stop(onClaim)}>Claim</button>}
        {mine && <button className="btn" onClick={stop(onRelease)}>Release</button>}
        {r.state !== 'closed' && <button className="btn" onClick={stop(onResolve)}>Resolve</button>}
      </div>
    </div>
  );
});

export default function Board() {
  const { identity } = useSpacetimeDB();
  const run = useRun();
  const toast = useToast();
  const now = useNow();
  const [requests, ready] = useTable(tables.request);
  const [responders] = useTable(tables.responder);
  const [households] = useTable(tables.household);
  const byHandle = useMemo(() => new Map(households.map((h) => [h.handle, h])), [households]);
  const [selected, setSelected] = useState<bigint | null>(null);
  const [filter, setFilter] = useState<Cat | 'all'>('all');
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of responders) m.set(x.identity.toHexString(), x.name);
    return m;
  }, [responders]);

  const { top, counts, total, open, critical } = useMemo(() => {
    const c: Record<Cat, number> = { help: 0, waiting: 0, silent: 0, claimed: 0, safe: 0 };
    let crit = 0;
    const shown: Request[] = [];
    for (const r of requests) {
      const k = catOf(r);
      c[k]++;
      if (k !== 'safe' && r.tier === 'critical') crit++;
      if (filter === 'all' || filter === k) shown.push(r);
    }
    return {
      top: shown.sort(compare).slice(0, MAX_ROWS),
      counts: c,
      total: requests.length,
      open: requests.length - c.safe,
      critical: crit,
    };
  }, [requests, filter]);
  const shownTotal = filter === 'all' ? total : counts[filter];

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

  // Detail panel shows the clicked row, or the top-ranked one until you click.
  const selectedReq =
    (selected !== null ? requests.find((r) => r.id === selected) : undefined) ?? top[0];

  const handled = total ? Math.round(((counts.claimed + counts.safe) / total) * 100) : 0;

  return (
    <div className="board">
      <header className="head">
        <div>
          <div className="eyebrow">Nobody Missed · Responder board</div>
          <h1>Check-In Command Center</h1>
        </div>
        <span className="spacer" />
        <span className="simtag">Simulated storm · synthetic policyholders</span>
        <a className="btn" href="#/board">Check-ins</a>
      </header>

      <section className="card summary">
        <div className="sumtop">
          <div>
            <span className="eyebrow">Claimed or safe</span> <span className="pct">{handled}%</span>
          </div>
          <div className="meta">{open.toLocaleString()} open · {critical.toLocaleString()} critical · {total.toLocaleString()} total</div>
        </div>
        <div className="stack">
          {CATS.map((c) => counts[c.key] > 0 && (
            <i key={c.key} style={{ flex: counts[c.key], background: c.color }} />
          ))}
        </div>
        <div className="legend">
          {CATS.map((c) => (
            <span key={c.key}><b className="dot" style={{ background: c.color }} />{counts[c.key].toLocaleString()} <em>{c.label}</em></span>
          ))}
        </div>
      </section>

      <div className="cols">
        <section className="card queue">
          <div className="qhead">
            <h2>Ranked queue</h2>
            <div className="tabs">
              <button className={`tab ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>All <span>{total.toLocaleString()}</span></button>
              {CATS.map((c) => (
                <button key={c.key} className={`tab ${filter === c.key ? 'on' : ''}`} onClick={() => setFilter(c.key)}>
                  <b className="dot" style={{ background: c.color }} />{c.label} <span>{counts[c.key].toLocaleString()}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="list">
            {!ready && <p className="empty">Loading…</p>}
            {ready && top.length === 0 && <p className="empty">Nothing here.</p>}
            {top.map((r) => {
              const hex = r.claimedBy?.toHexString();
              return (
                <Row
                  key={r.id.toString()}
                  r={r}
                  household={byHandle.get(r.victimHandle)}
                  now={now}
                  mine={!!hex && hex === me}
                  claimer={hex ? names.get(hex) ?? 'A responder' : ''}
                  fresh={freshIds.has(r.id.toString())}
                  selected={selectedReq?.id === r.id}
                  onOpen={setSelected}
                  onClaim={onClaim}
                  onRelease={onRelease}
                  onResolve={onResolve}
                />
              );
            })}
            {shownTotal > MAX_ROWS && <p className="empty">Showing the top {MAX_ROWS} of {shownTotal.toLocaleString()}.</p>}
          </div>
        </section>

        <div className="side">
          {selectedReq && (
            <Detail
              r={selectedReq}
              household={byHandle.get(selectedReq.victimHandle)}
              now={now}
              mine={!!selectedReq.claimedBy && selectedReq.claimedBy.toHexString() === me}
              onClaim={onClaim}
              onRelease={onRelease}
              onResolve={onResolve}
            />
          )}
        </div>
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

function Detail({ r, household, now, mine, onClaim, onRelease, onResolve }: {
  r: Request; household?: Household; now: number; mine: boolean;
  onClaim: (id: bigint) => void; onRelease: (id: bigint) => void; onResolve: (id: bigint) => void;
}) {
  const person = useMemo(() => personFor(r, household), [r.id, r.victimHandle, r.rawText, household]); // eslint-disable-line react-hooks/exhaustive-deps
  const reasons = parseReasons(r.reasons);
  const quotes = parseQuotes(r.facts);
  const claimed = !!r.claimedBy;

  return (
    <aside className="card detail">
      <div className="dhead">
        <div>
          <h2>{person.name}</h2>
          <div className="meta">
            {person.age ? `Age ${person.age} · ` : ''}{person.address ?? r.victimHandle}
          </div>
          {person.policy && <div className="meta">{person.policy} policy · {person.policyNo}</div>}
        </div>
        <div className="urgency">
          <span className={`big tier-${r.tier}`}>{r.score}</span>
          <span className="l">Urgency</span>
        </div>
      </div>

      <EscalationLadder r={r} />

      <div className="why">
        <div className="whyl">Why this ranking</div>
        <div>
          {person.issue}
          {quotes.length > 0 && <> — said “{quotes.join('”, “')}”</>}. Base {r.baseScore} + {r.escalation} for waiting unclaimed = {r.score}.
        </div>
        {reasons.length > 0 && <div className="reasons">{reasons.map((x, i) => <span key={i} className="reason">{x}</span>)}</div>}
      </div>

      <div className="bubble">
        <Highlighted text={r.rawText} quotes={quotes} />
      </div>
      <div className="stamp">Resident · {new Date(tsMs(r.createdAt)).toLocaleTimeString()} · open {mmss(now - tsMs(r.createdAt))}</div>

      <div className="dactions">
        {!claimed && r.state !== 'closed' && <button className="btn big primary" onClick={() => onClaim(r.id)}>Claim</button>}
        {mine && <button className="btn big" onClick={() => onRelease(r.id)}>Release</button>}
        {r.state !== 'closed' && <button className="btn big" onClick={() => onResolve(r.id)}>Resolve</button>}
      </div>

      <h3>Check-ins · {r.checkinsSent} texts · {r.callsPlaced} calls</h3>
      <CheckinLog key={r.id.toString()} r={r} />

      <h3>Facts</h3>
      <CaseFacts r={r} />
    </aside>
  );
}
