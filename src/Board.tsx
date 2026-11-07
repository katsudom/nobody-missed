import { memo, useMemo, useRef, useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import type { Infer } from 'spacetimedb';
import RequestRow from './module_bindings/request_table';
import {
  Highlighted, mmss, parseJson, parseQuotes, parseReasons, tsMs, useNow, useRun,
} from './lib';

type Request = Infer<typeof RequestRow>;
const MAX_ROWS = 200;

const STATE_LABEL: Record<string, string> = {
  new: 'New',
  waiting: 'Waiting',
  checkin_text_sent: 'Text sent',
  call_placed: 'Call placed',
  flagged: 'Needs welfare check',
  claimed: 'Claimed',
  closed: 'Closed',
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

const Row = memo(function Row({ r, now, mine, claimer, fresh, selected, onOpen, onClaim, onRelease, onResolve }: RowProps) {
  const quotes = useMemo(() => parseQuotes(r.facts), [r.facts]);
  const reasons = useMemo(() => parseReasons(r.reasons), [r.reasons]);
  const claimed = !!r.claimedBy;
  const stop = (fn: (id: bigint) => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn(r.id);
  };
  const timer = claimed ? `claimed by ${claimer}` : `unclaimed ${mmss(now - tsMs(r.createdAt))}`;

  return (
    <div
      className={`row ${r.state === 'flagged' ? 'flagged' : ''} ${selected ? 'selected' : ''} ${fresh ? 'pulse' : ''}`}
      onClick={() => onOpen(r.id)}
    >
      <div className="status">
        <span className={`pill state-${r.state}`}>{STATE_LABEL[r.state] ?? r.state}</span>
        <span className="timer">{timer}</span>
      </div>
      <div className="main">
        <div className="text"><Highlighted text={r.rawText} quotes={quotes} /></div>
        <div className="sub">
          <span className={`tier tier-${r.tier}`}>{r.tier}</span>
          {reasons.map((x, i) => <span key={i} className="reason">{x}</span>)}
        </div>
      </div>
      <div className={`bar tier-${r.tier}`}><i style={{ width: `${Math.min(100, r.score)}%` }} /></div>
      <span className={`score tier-${r.tier}`}>{r.score}</span>
      <div className="actions">
        {!claimed && r.state !== 'closed' && <button className="btn claim" onClick={stop(onClaim)}>Claim</button>}
        {mine && <button className="btn" onClick={stop(onRelease)}>Release</button>}
        {r.state !== 'closed' && <button className="btn" onClick={stop(onResolve)}>Resolve</button>}
      </div>
    </div>
  );
});

export default function Board() {
  const { identity } = useSpacetimeDB();
  const run = useRun();
  const now = useNow();
  const [requests, ready] = useTable(tables.request);
  const [responders] = useTable(tables.responder);
  const [selected, setSelected] = useState<bigint | null>(null);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of responders) m.set(x.identity.toHexString(), x.name);
    return m;
  }, [responders]);

  const { top, counts, total } = useMemo(() => {
    const open = requests.filter((r) => r.state !== 'closed');
    const c = { open: open.length, critical: 0, flagged: 0, claimed: 0 };
    for (const r of open) {
      if (r.tier === 'critical') c.critical++;
      if (r.state === 'flagged') c.flagged++;
      if (r.claimedBy) c.claimed++;
    }
    return { top: [...open].sort(compare).slice(0, MAX_ROWS), counts: c, total: open.length };
  }, [requests]);

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
  const onReset = () => {
    if (window.confirm('Reset demo clears the SHARED database for EVERYONE. Has the whole team agreed?')) {
      run((c) => c.reducers.resetDemo({}));
    }
  };

  // Detail panel shows the clicked row, or the top-ranked one until you click.
  const selectedReq =
    (selected !== null ? requests.find((r) => r.id === selected) : undefined) ?? top[0];

  return (
    <div className="board">
      <header className="head">
        <div>
          <div className="eyebrow">Nobody Missed · Responder board</div>
          <h1>Check-In Command Center</h1>
        </div>
        <span className="spacer" />
        <button className="btn big" onClick={onInject}>Inject 2,000</button>
        <button className="btn big danger" onClick={onReset}>Reset demo</button>
      </header>

      <section className="card summary">
        <Count label="Open" n={counts.open} />
        <Count label="Critical" n={counts.critical} cls="critical" />
        <Count label="Flagged" n={counts.flagged} cls="flagged" />
        <Count label="Claimed" n={counts.claimed} cls="claimed" />
      </section>

      <div className="cols">
        <section className="card queue">
          <h2>Ranked queue</h2>
          <div className="list">
            {!ready && <p className="empty">Loading…</p>}
            {ready && top.length === 0 && <p className="empty">No open requests.</p>}
            {top.map((r) => {
              const hex = r.claimedBy?.toHexString();
              return (
                <Row
                  key={r.id.toString()}
                  r={r}
                  now={now}
                  mine={!!hex && hex === me}
                  claimer={hex ? names.get(hex) ?? 'a responder' : ''}
                  fresh={freshIds.has(r.id.toString())}
                  selected={selectedReq?.id === r.id}
                  onOpen={setSelected}
                  onClaim={onClaim}
                  onRelease={onRelease}
                  onResolve={onResolve}
                />
              );
            })}
            {total > MAX_ROWS && <p className="empty">Showing the top {MAX_ROWS} of {total.toLocaleString()} open requests.</p>}
          </div>
        </section>

        {selectedReq && <Detail r={selectedReq} now={now} />}
      </div>
    </div>
  );
}

function Count({ label, n, cls = '' }: { label: string; n: number; cls?: string }) {
  return (
    <div className={`count ${cls}`}>
      <span className="n">{n.toLocaleString()}</span>
      <span className="l">{label}</span>
    </div>
  );
}

function Detail({ r, now }: { r: Request; now: number }) {
  const [outbox] = useTable(tables.outbox);
  const [calls] = useTable(tables.call);

  const history = useMemo(() => {
    const items = [
      ...outbox.filter((o) => o.requestId === r.id).map((o) => ({
        at: tsMs(o.createdAt),
        label: o.kind.replace(/_/g, ' '),
        detail: o.status,
        extra: o.payload,
      })),
      ...calls.filter((c) => c.requestId === r.id).map((c) => ({
        at: tsMs(c.createdAt),
        label: 'call',
        detail: c.result + (c.dtmf ? ` (pressed ${c.dtmf})` : ''),
        extra: c.externalId,
      })),
    ];
    return items.sort((a, b) => a.at - b.at);
  }, [outbox, calls, r.id]);

  const facts = useMemo(() => parseJson<unknown>(r.facts, r.facts), [r.facts]);
  const reasons = parseReasons(r.reasons);

  return (
    <aside className="card detail">
      <div className="dhead">
        <div>
          <h2>Request #{r.id.toString()}</h2>
          <div className="meta">
            {r.platform} · {r.victimHandle} · open {mmss(now - tsMs(r.createdAt))}
          </div>
        </div>
        <div className="urgency">
          <span className={`big tier-${r.tier}`}>{r.score}</span>
          <span className="l">Urgency</span>
        </div>
      </div>

      <div className="why">
        <div className="whyl">Why this ranking</div>
        <div>base {r.baseScore} + escalation {r.escalation} = {r.score}</div>
        <div className="reasons">{reasons.length ? reasons.map((x, i) => <span key={i} className="reason">{x}</span>) : 'no rules fired'}</div>
      </div>

      <h3>Message</h3>
      <div className="text msg"><Highlighted text={r.rawText} quotes={parseQuotes(r.facts)} /></div>

      <h3>Check-ins · {r.checkinsSent} texts · {r.callsPlaced} calls</h3>
      {history.length === 0 && <p className="empty left">Nothing sent yet.</p>}
      <ul className="history">
        {history.map((h, i) => (
          <li key={i}>
            <b>{new Date(h.at).toLocaleTimeString()}</b> {h.label} — {h.detail}
            <div className="extra">{h.extra}</div>
          </li>
        ))}
      </ul>

      <h3>Facts ({r.factsStatus})</h3>
      <pre>{JSON.stringify(facts, null, 2)}</pre>
    </aside>
  );
}
