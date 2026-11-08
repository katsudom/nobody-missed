import { memo, useMemo, useRef, useState } from 'react';
import DevTools from './DevTools';
import PageTabs from './PageTabs';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import type { Infer } from 'spacetimedb';
import RequestRow from './module_bindings/request_table';
import HouseholdRow from './module_bindings/household_table';
import {
  byLevel, Highlighted, Level, levelOf, mmss, parseQuotes, parseReasons, tsMs, useNow, useRun, useToast,
} from './lib';
import { maskPhone, personFor } from './policyholders';

type Request = Infer<typeof RequestRow>;
type Household = Infer<typeof HouseholdRow>;
const MAX_ROWS = 200;

type Cat = 'help' | 'silent' | 'claimed' | 'safe';
const CATS: { key: Cat; label: string; color: string }[] = [
  { key: 'help', label: 'Needs help', color: 'var(--red)' },
  { key: 'silent', label: 'Silent', color: 'var(--grey)' },
  { key: 'claimed', label: 'Taken', color: 'var(--blue)' },
  { key: 'safe', label: 'Safe', color: 'var(--green)' },
];

function catOf(r: Request): Cat {
  if (r.state === 'closed') return 'safe';
  if (r.state === 'flagged') return 'silent';
  if (r.claimedBy) return 'claimed';
  return 'help';
}

const STATE_LABEL: Record<string, string> = {
  new: 'Needs help',
  waiting: 'Needs help',
  checkin_text_sent: 'Text sent',
  call_placed: 'Call placed',
  flagged: 'Needs welfare check',
  claimed: 'Taken',
  closed: 'Safe',
};

// Level first (P1, P2, P3), then whoever has waited longest. The points stay hidden.
const compare = (a: Request, b: Request) => byLevel(a, b);

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
      <span className="score"><Level tier={r.tier} /></span>
      <div className="actions">
        {claimed && r.state !== 'closed' && <span className="onway">{claimer} is on the way</span>}
        {!claimed && r.state !== 'closed' && <button className="btn outline" onClick={stop(onClaim)}>Take case</button>}
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
  const [allRequests, ready] = useTable(tables.request);
  const requests = allRequests;
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
    const c: Record<Cat, number> = { help: 0, silent: 0, claimed: 0, safe: 0 };
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
        <PageTabs current="reports" />
      </header>

      <div className="cols">
        <section className="card queue">
          <div className="qhead">
            <div className="qtitle">
              <h2>Ranked queue</h2>
              <span className="qstat">
                <b>{handled}%</b> claimed or safe · {open.toLocaleString()} open · {critical.toLocaleString()} critical
              </span>
            </div>
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
              claimer={selectedReq.claimedBy ? names.get(selectedReq.claimedBy.toHexString()) ?? 'A responder' : ''}
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

// The storm alert texts as the module sends them (spacetimedb/src/rules.ts STORM_TEXT / STORM_RETEXT). Display only.
const STORM_TEXT = 'This is an automated emergency check-in. Reply 1 if you are safe. Reply 2 if you need help.';
const STORM_RETEXT = 'We have not heard from you. Reply 1 if you are safe, 2 if you need help.';

type ThreadItem =
  | { kind: 'out'; text: string; at?: number }
  | { kind: 'in'; text: string; highlight: boolean; at?: number }
  | { kind: 'call'; text: string; bad: boolean };

// Report detail, laid out as the text thread the resident actually saw (storyboard C).
function Detail({ r, household, now, mine, claimer, onClaim, onRelease, onResolve }: {
  r: Request; household?: Household; now: number; mine: boolean; claimer: string;
  onClaim: (id: bigint) => void; onRelease: (id: bigint) => void; onResolve: (id: bigint) => void;
}) {
  const [outbox] = useTable(tables.outbox);
  const [calls] = useTable(tables.call);
  const [checkins] = useTable(tables.checkin);
  const person = useMemo(() => personFor(r, household), [r.id, r.victimHandle, r.rawText, household]); // eslint-disable-line react-hooks/exhaustive-deps
  const reasons = parseReasons(r.reasons);
  const quotes = parseQuotes(r.facts);
  const claimed = !!r.claimedBy;
  const clock = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');

  const thread = useMemo(() => {
    const items: ThreadItem[] = [];
    // Storm alerts that led to this report, if it came from a check-in.
    const ci = checkins.find((c) => c.requestId === r.id);
    if (ci) {
      items.push({ kind: 'out', text: STORM_TEXT, at: tsMs(ci.createdAt) });
      if (ci.textsSent >= 2) items.push({ kind: 'out', text: STORM_RETEXT });
      if (ci.callsPlaced > 0) items.push({ kind: 'call', text: 'Check-in call', bad: false });
    }
    // What they said (later replies are appended to the same report).
    r.rawText.split('\n').filter(Boolean).forEach((line, i) =>
      items.push({ kind: 'in', text: line, highlight: i === 0, at: i === 0 ? tsMs(r.createdAt) : undefined }));
    // Follow-up texts and calls on the report itself, in order.
    const later = [
      ...outbox.filter((o) => o.requestId === r.id && o.kind === 'send_text').map((o) => {
        let text = 'Check-in text';
        try { text = (JSON.parse(o.payload) as { text?: string }).text ?? text; } catch { /* keep default */ }
        return { t: tsMs(o.createdAt), item: { kind: 'out', text, at: tsMs(o.createdAt) } as ThreadItem };
      }),
      ...calls.filter((c) => c.requestId === r.id && c.checkinId === 0n).map((c) => ({
        t: tsMs(c.createdAt),
        item: {
          kind: 'call',
          text: c.result === 'answered' ? `Call answered${c.dtmf ? `, pressed ${c.dtmf}` : ''} · ${clock(tsMs(c.createdAt))}` : `Missed call · ${clock(tsMs(c.createdAt))}`,
          bad: c.result !== 'answered',
        } as ThreadItem,
      })),
    ].sort((a, b) => a.t - b.t).map((x) => x.item);
    return [...items, ...later];
  }, [checkins, outbox, calls, r.id, r.rawText, r.createdAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const band =
    r.state === 'flagged' ? { tone: 'red', title: 'No contact · go now', sub: `Silent for ${mmss(now - tsMs(r.updatedAt))}` }
    : r.state === 'closed' ? { tone: 'grey', title: 'Resolved', sub: `Closed ${clock(tsMs(r.updatedAt))}` }
    : claimed ? { tone: 'blue', title: `${claimer || 'A responder'} is on it`, sub: `Taken ${clock(tsMs(r.updatedAt))}` }
    : { tone: 'amber', title: 'Needs help', sub: `Reported ${clock(tsMs(r.createdAt))} · unclaimed ${mmss(now - tsMs(r.createdAt))}` };

  return (
    <aside className={`card detail ticket t-${band.tone}`} aria-label="Report details">
      <div className="tband">
        <div className="tbandtext">
          <span className="ttitle">{band.title}</span>
          <span className="tsub">{band.sub}</span>
        </div>
        <div className="tscore"><span>{levelOf(r.tier).label}</span><em>{levelOf(r.tier).name}</em></div>
      </div>
      <div className="tbody">
        <div className="tperson">
          <h2>{person.name}</h2>
          <div className="meta">
            {[person.age ? String(person.age) : '', person.address ?? maskPhone(r.victimHandle), person.policy ? `${person.policy} policy` : ''].filter(Boolean).join(' · ')}
          </div>
        </div>

        <div className="thread" aria-label="Messages">
          {thread.map((m, i) =>
            m.kind === 'call' ? (
              <div key={i} className={`tcall ${m.bad ? 'bad' : ''}`}>{m.text}</div>
            ) : m.kind === 'out' ? (
              <div key={i} className="tout">{m.text}</div>
            ) : (
              <div key={i} className="tin">{m.highlight ? <Highlighted text={m.text} quotes={quotes} /> : m.text}</div>
            )
          )}
        </div>

        {reasons.length > 0 && (
          <div className="tchips">{reasons.map((x) => <span key={x} className="tchip">{x}</span>)}</div>
        )}

        <div className="tactions">
          {!claimed && r.state !== 'closed' && <button className="tbtn main" onClick={() => onClaim(r.id)}>{r.state === 'flagged' ? 'Take case · send someone' : 'Take case'}</button>}
          {mine && <button className="tbtn" onClick={() => onRelease(r.id)}>Release</button>}
          {r.state !== 'closed' && <button className="tbtn" onClick={() => onResolve(r.id)}>Resolve</button>}
        </div>
      </div>
    </aside>
  );
}
