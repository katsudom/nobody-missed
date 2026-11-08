// Storm check-in board (docs/checkin-plan.md). Display only: the module runs the ladder,
// the timers and the claims; this page shows them and calls reducers.
import { memo, useMemo, useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import type { Infer } from 'spacetimedb';
import { tables } from './module_bindings';
import CheckinRowT from './module_bindings/checkin_table';
import HouseholdRowT from './module_bindings/household_table';
import StormRowT from './module_bindings/storm_table';
import RequestRowT from './module_bindings/request_table';
import { Highlighted, mmss, parseQuotes, parseReasons, tsMs, useNow, useRun, useToast } from './lib';
import DevTools from './DevTools';

type Checkin = Infer<typeof CheckinRowT>;
type Household = Infer<typeof HouseholdRowT>;
type Storm = Infer<typeof StormRowT>;
type Request = Infer<typeof RequestRowT>;

const MAX_ROWS = 200;
// Mirrors spacetimedb/src/rules.ts (S1_RETEXT, S2_CALL, S3_URGENT in demo seconds). Display only.
const NEXT_STEP_MS: Record<string, { ms: number; label: string }> = {
  texted: { ms: 15_000, label: 're-text in' },
  retexted: { ms: 10_000, label: 'call in' },
  called: { ms: 10_000, label: 'urgent in' },
};

type Bucket = 'urgent' | 'help' | 'waiting' | 'safe' | 'handled';
const BUCKETS: { key: Bucket; label: string; color: string }[] = [
  { key: 'urgent', label: 'Urgent: no contact', color: 'var(--red)' },
  { key: 'help', label: 'Needs help', color: 'var(--amber)' },
  { key: 'waiting', label: 'Waiting for reply', color: 'var(--grey)' },
  { key: 'safe', label: 'Checked in safe', color: 'var(--green)' },
  { key: 'handled', label: 'Responder on it', color: 'var(--blue)' },
];
const COLOR = Object.fromEntries(BUCKETS.map((b) => [b.key, b.color])) as Record<Bucket, string>;

function bucketOf(c: Checkin): Bucket {
  switch (c.state) {
    case 'urgent': return 'urgent';
    case 'needs_help': return 'help';
    case 'safe': return 'safe';
    case 'claimed':
    case 'closed': return 'handled';
    default: return 'waiting';
  }
}

const STATE_LABEL: Record<string, string> = {
  texted: 'Alert sent',
  retexted: 'Re-texted',
  called: 'Calling',
  safe: 'Safe',
  needs_help: 'Needs help',
  urgent: 'Urgent',
  claimed: 'Claimed',
  closed: 'Closed',
};

const LADDER = ['texted', 'retexted', 'called', 'urgent'];

export default function CheckinBoard() {
  const { identity } = useSpacetimeDB();
  const run = useRun();
  const toast = useToast();
  const now = useNow();
  const [checkins, ready] = useTable(tables.checkin);
  const [households] = useTable(tables.household);
  const [storms] = useTable(tables.storm);
  const [requests] = useTable(tables.request);
  const [responders] = useTable(tables.responder);
  const [picked, setTab] = useState<Bucket | 'all' | null>(null); // null = follow the most serious non-empty tab
  const [selected, setSelected] = useState<bigint | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const storm = storms.find((s) => s.active) ?? [...storms].sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  const hh = useMemo(() => new Map(households.map((h) => [h.id, h])), [households]);
  const reqs = useMemo(() => new Map(requests.map((r) => [r.id, r])), [requests]);
  const names = useMemo(() => new Map(responders.map((r) => [r.identity.toHexString(), r.name])), [responders]);

  // Only the latest storm's check-ins count.
  const { mine, counts, rows, tab } = useMemo(() => {
    const list = storm ? checkins.filter((c) => c.stormId === storm.id) : [];
    const k: Record<Bucket, number> = { urgent: 0, help: 0, waiting: 0, safe: 0, handled: 0 };
    for (const c of list) k[bucketOf(c)]++;
    const tab: Bucket | 'all' = picked ?? (['urgent', 'help', 'waiting'] as Bucket[]).find((b) => k[b] > 0) ?? 'all';
    const shown = tab === 'all' ? [...list] : list.filter((c) => bucketOf(c) === tab);
    const score = (c: Checkin) => reqs.get(c.requestId)?.score ?? 0;
    shown.sort((a, b) => {
      if (tab === 'help') return score(b) - score(a);
      if (tab === 'safe' || tab === 'handled') return a.updatedAt.microsSinceUnixEpoch < b.updatedAt.microsSinceUnixEpoch ? 1 : -1;
      // urgent / waiting / all: furthest along the ladder first, then longest waiting
      const order = ['urgent', 'needs_help', 'called', 'retexted', 'texted', 'claimed', 'safe', 'closed'];
      return order.indexOf(a.state) - order.indexOf(b.state) ||
        (a.updatedAt.microsSinceUnixEpoch < b.updatedAt.microsSinceUnixEpoch ? -1 : 1);
    });
    return { mine: list, counts: k, rows: shown.slice(0, MAX_ROWS), tab };
  }, [checkins, storm, picked, reqs]);

  const total = mine.length;
  const replied = mine.filter((c) => c.reply !== '' || c.state === 'safe' || c.state === 'needs_help').length;
  const pct = total ? Math.round((counts.safe / total) * 100) : 0;
  const shownTotal = tab === 'all' ? total : counts[tab];

  const selectedC = (selected !== null ? mine.find((c) => c.id === selected) : undefined) ?? rows[0];
  const byHousehold = useMemo(() => new Map(mine.map((c) => [c.householdId, c])), [mine]);
  const meHex = identity?.toHexString();

  const claim = (id: bigint) => run((c) => c.reducers.claimCheckin({ checkinId: id }));
  const release = (id: bigint) => run((c) => c.reducers.releaseCheckin({ checkinId: id }));
  const resolve = (id: bigint) => run((c) => c.reducers.resolveCheckin({ checkinId: id }));
  const doReset = async () => {
    setConfirmReset(false);
    if (await run((c) => c.reducers.resetDemo({}))) toast('Demo reset for everyone', true);
  };

  return (
    <div className="board">
      <header className="head">
        <div>
          <div className="eyebrow">Nobody Missed · Storm check-ins</div>
          <h1>Check-In Command Center</h1>
        </div>
        <span className="spacer" />
        <StormChip storm={storm} now={now} inZone={total} />
        <a className="btn" href="#/reports">Reports board</a>
      </header>

      <section className="card summary">
        <div className="sumtop">
          <div>
            <span className="eyebrow">Checked in</span> <span className="pct">{pct}%</span>
          </div>
          <div className="meta">{replied.toLocaleString()} of {total.toLocaleString()} households in the zone have replied · {households.length.toLocaleString()} households on file</div>
        </div>
        <div className="stack">
          {BUCKETS.map((b) => counts[b.key] > 0 && <i key={b.key} style={{ flex: counts[b.key], background: b.color }} />)}
        </div>
        <div className="legend">
          {BUCKETS.map((b) => (
            <span key={b.key}><b className="dot" style={{ background: b.color }} />{counts[b.key].toLocaleString()} <em>{b.label}</em></span>
          ))}
        </div>
      </section>

      <div className="cols">
        <section className="card queue">
          <div className="qhead">
            <h2>Households in the zone</h2>
            <div className="tabs">
              {BUCKETS.map((b) => (
                <button key={b.key} className={`tab ${tab === b.key ? 'on' : ''}`} onClick={() => setTab(b.key)}>
                  <b className="dot" style={{ background: b.color }} />{b.label} <span>{counts[b.key].toLocaleString()}</span>
                </button>
              ))}
              <button className={`tab ${tab === 'all' ? 'on' : ''}`} onClick={() => setTab('all')}>All <span>{total.toLocaleString()}</span></button>
            </div>
          </div>
          <div className="list">
            {!ready && <p className="empty">Loading…</p>}
            {ready && !storm && <p className="empty">No storm yet. An admin starts one from the Dev panel.</p>}
            {ready && storm && rows.length === 0 && <p className="empty">Nobody here.</p>}
            {rows.map((c) => (
              <CheckinRow
                key={c.id.toString()}
                c={c}
                h={hh.get(c.householdId)}
                req={c.requestId !== 0n ? reqs.get(c.requestId) : undefined}
                now={now}
                claimer={c.claimedBy ? names.get(c.claimedBy.toHexString()) ?? 'A responder' : ''}
                mine={!!c.claimedBy && c.claimedBy.toHexString() === meHex}
                selected={selectedC?.id === c.id}
                onOpen={setSelected}
                onClaim={claim}
                onRelease={release}
                onResolve={resolve}
              />
            ))}
            {shownTotal > MAX_ROWS && <p className="empty">Showing the first {MAX_ROWS} of {shownTotal.toLocaleString()}.</p>}
          </div>
        </section>

        <div className="side">
          <section className="card mapcard">
            <div className="mapnote">
              {households.length.toLocaleString()} households · {storm?.active ? 'storm zone in red' : 'no active storm'} · positions simulated
            </div>
            <StormMap households={households} storm={storm} byHousehold={byHousehold} selected={selectedC} onPick={setSelected} />
          </section>
          {selectedC && (
            <CheckinDetail
              c={selectedC}
              h={hh.get(selectedC.householdId)}
              req={selectedC.requestId !== 0n ? reqs.get(selectedC.requestId) : undefined}
              now={now}
              claimer={selectedC.claimedBy ? names.get(selectedC.claimedBy.toHexString()) ?? 'A responder' : ''}
              mine={!!selectedC.claimedBy && selectedC.claimedBy.toHexString() === meHex}
              onClaim={claim}
              onRelease={release}
              onResolve={resolve}
            />
          )}
        </div>
      </div>

      <DevTools onAskReset={() => setConfirmReset(true)} />

      {confirmReset && (
        <div className="modal" onClick={() => setConfirmReset(false)}>
          <div className="modalbox" onClick={(e) => e.stopPropagation()}>
            <h2>Reset the demo?</h2>
            <p className="meta">Deletes every storm, check-in, request and call in the SHARED database for everyone. Households stay.</p>
            <div className="actions">
              <button className="btn big" onClick={() => setConfirmReset(false)}>Cancel</button>
              <button className="btn big danger solid" onClick={doReset}>Yes, reset for everyone</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StormChip({ storm, now, inZone }: { storm?: Storm; now: number; inZone: number }) {
  if (!storm) return <span className="simtag">No storm</span>;
  const since = mmss(now - tsMs(storm.startedAt));
  return storm.active
    ? <span className="stormchip on">Storm active · {inZone.toLocaleString()} in zone · {since}</span>
    : <span className="simtag">Last storm ended</span>;
}

function nextStep(c: Checkin, now: number) {
  const step = NEXT_STEP_MS[c.state];
  if (!step || c.claimedBy) return '';
  const left = step.ms - (now - tsMs(c.updatedAt));
  return left > 0 ? `${step.label} ${mmss(left)}` : `${step.label.replace(/ in$/, '')} now`;
}

type RowProps = {
  c: Checkin; h?: Household; req?: Request; now: number; claimer: string; mine: boolean; selected: boolean;
  onOpen: (id: bigint) => void; onClaim: (id: bigint) => void; onRelease: (id: bigint) => void; onResolve: (id: bigint) => void;
};

const CheckinRow = memo(function CheckinRow({ c, h, req, now, claimer, mine, selected, onOpen, onClaim, onRelease, onResolve }: RowProps) {
  const b = bucketOf(c);
  const stop = (fn: (id: bigint) => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(c.id); };
  const waitedFor = mmss(now - tsMs(c.createdAt));
  return (
    <div className={`row crow ${b === 'urgent' ? 'flagged' : ''} ${selected ? 'selected' : ''}`} onClick={() => onOpen(c.id)}>
      <div className="status">
        <span className={`pill b-${b}`}>{STATE_LABEL[c.state] ?? c.state}</span>
        <span className="timer">{nextStep(c, now) || `since alert ${waitedFor}`}</span>
      </div>
      <div className="main">
        <div className="name">{h?.name ?? 'Unknown household'}{h?.real && <span className="realtag">team phone</span>}</div>
        <div className="text">
          {req ? req.rawText.split('\n')[0] : h ? `${h.address}${h.age ? ` · age ${h.age}` : ''}` : ''}
        </div>
        <div className="sub">
          <span className="reason">{c.textsSent} text{c.textsSent === 1 ? '' : 's'}</span>
          {c.callsPlaced > 0 && <span className="reason">{c.callsPlaced} call{c.callsPlaced === 1 ? '' : 's'}</span>}
          {c.reply && <span className="reason">replied “{c.reply.slice(0, 30)}”</span>}
        </div>
      </div>
      <span className={`score ${req ? `tier-${req.tier}` : ''}`}>{req ? req.score : ''}</span>
      <div className="actions">
        {c.claimedBy && <span className="onway">{claimer} is on it</span>}
        {!c.claimedBy && (b === 'urgent' || b === 'help' || b === 'waiting') && (
          <button className="btn outline" onClick={stop(onClaim)}>Claim</button>
        )}
        {mine && <button className="btn" onClick={stop(onRelease)}>Release</button>}
        {(b === 'urgent' || b === 'help' || mine) && <button className="btn" onClick={stop(onResolve)}>Resolve</button>}
      </div>
    </div>
  );
});

function CheckinDetail({ c, h, req, now, claimer, mine, onClaim, onRelease, onResolve }: Omit<RowProps, 'selected' | 'onOpen'>) {
  const [outbox] = useTable(tables.outbox);
  const [calls] = useTable(tables.call);
  const b = bucketOf(c);
  const reached = LADDER.indexOf(c.state);
  const quotes = req ? parseQuotes(req.facts) : [];
  const reasons = req ? parseReasons(req.reasons) : [];

  const log = useMemo(() => [
    ...outbox.filter((o) => o.checkinId === c.id).map((o) => ({ at: tsMs(o.createdAt), text: `${o.kind === 'place_call' ? 'Call' : 'Text'} ${o.status}` })),
    ...calls.filter((x) => x.checkinId === c.id).map((x) => ({ at: tsMs(x.createdAt), text: `Call ${x.result}${x.dtmf ? `, pressed ${x.dtmf}` : ''}` })),
  ].sort((a, z) => a.at - z.at), [outbox, calls, c.id]);

  return (
    <aside className="card detail">
      <div className="dhead">
        <div>
          <h2>{h?.name ?? 'Unknown household'}</h2>
          {h && <div className="meta">{h.age ? `Age ${h.age} · ` : ''}{h.address}</div>}
          {h && <div className="meta">{h.policy} policy · {h.real ? h.handle : 'simulated household'}</div>}
        </div>
        <div className="urgency">
          <span className={`big ${req ? `tier-${req.tier}` : ''}`} style={req ? undefined : { color: COLOR[b] }}>{req ? req.score : STATE_LABEL[c.state]}</span>
          <span className="l">{req ? 'Urgency' : 'Status'}</span>
        </div>
      </div>

      <ol className="ladder2">
        {['Alert sent', 'Re-texted', 'Called', 'Urgent'].map((label, i) => (
          <li key={label} className={reached >= i ? (i === 3 ? 'bad' : 'done') : ''}>{label}</li>
        ))}
      </ol>
      <div className="meta">
        {nextStep(c, now) || (b === 'safe' ? 'Checked in. No more texts.' : b === 'handled' ? `${claimer || 'A responder'} is on it.` : '')}
      </div>

      {c.reply && (
        <>
          <div className="bubble">{req ? <Highlighted text={req.rawText} quotes={quotes} /> : c.reply}</div>
          <div className="stamp">Resident · {new Date(tsMs(c.updatedAt)).toLocaleTimeString()}</div>
        </>
      )}

      {req && (
        <div className="why">
          <div className="whyl">Why this ranking</div>
          <div>Base {req.baseScore} + {req.escalation} for waiting unclaimed = {req.score}.</div>
          {reasons.length > 0 && <div className="reasons">{reasons.map((x, i) => <span key={i} className="reason">{x}</span>)}</div>}
        </div>
      )}

      <div className="dactions">
        {!c.claimedBy && b !== 'safe' && b !== 'handled' && <button className="btn big primary" onClick={() => onClaim(c.id)}>Claim</button>}
        {mine && <button className="btn big" onClick={() => onRelease(c.id)}>Release</button>}
        {(b === 'urgent' || b === 'help' || mine) && <button className="btn big" onClick={() => onResolve(c.id)}>Resolve</button>}
      </div>

      <h3>Texts and calls · {c.textsSent} texts · {c.callsPlaced} calls</h3>
      {h && !h.real && <p className="empty left">Simulated household: nothing is really sent.</p>}
      <ul className="history">
        {log.map((x, i) => <li key={i}><b>{new Date(x.at).toLocaleTimeString()}</b> {x.text}</li>)}
      </ul>
    </aside>
  );
}

// ---------- Map ----------
const W = 420, H = 300;

const StormMap = memo(function StormMap({ households, storm, byHousehold, selected, onPick }: {
  households: readonly Household[]; storm?: Storm; byHousehold: Map<bigint, Checkin>; selected?: Checkin; onPick: (id: bigint) => void;
}) {
  const sel = selected ? households.find((h) => h.id === selected.householdId) : undefined;
  return (
    <svg className="map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Map of households and the storm zone">
      <defs>
        <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
          <path d="M28 0H0V28" fill="none" stroke="#1d1d21" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#grid)" />
      <path d="M0 170 C 90 140, 150 210, 230 170 S 360 150, 420 180" fill="none" stroke="#1b2740" strokeWidth="14" />
      {storm?.active && (
        // The server's zone is a circle in 0..1 map units, so on this wide map it is an ellipse.
        <ellipse cx={storm.cx * W} cy={storm.cy * H} rx={storm.r * W} ry={storm.r * H}
          fill="#ff4d5e14" stroke="#ff4d5e" strokeDasharray="6 5" />
      )}
      {households.map((h) => {
        const c = byHousehold.get(h.id);
        const color = c ? COLOR[bucketOf(c)] : '#3a3a42';
        return (
          <circle key={h.id.toString()} cx={h.x * W} cy={h.y * H} r={h.real ? 5 : c ? 2.6 : 1.8} fill={color}
            stroke={h.real ? '#fff' : undefined} strokeWidth={h.real ? 1.5 : undefined}
            onClick={c ? () => onPick(c.id) : undefined} style={c ? { cursor: 'pointer' } : undefined} />
        );
      })}
      {sel && <circle cx={sel.x * W} cy={sel.y * H} r="10" fill="none" stroke="#fff" strokeWidth="2" />}
    </svg>
  );
});
