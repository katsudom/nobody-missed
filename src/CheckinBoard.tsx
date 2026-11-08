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
import { byLevel, Level, levelOf, mmss, parseReasons, tsMs, useNow, useRun, useToast } from './lib';
import DevTools from './DevTools';
import { useMode } from './mode';

type Checkin = Infer<typeof CheckinRowT>;
type Household = Infer<typeof HouseholdRowT>;
type Storm = Infer<typeof StormRowT>;
type Request = Infer<typeof RequestRowT>;

const MAX_ROWS = 200;
// Mirrors spacetimedb/src/rules.ts (S1_RETEXT, S2_CALL, S3_URGENT in demo seconds). Display only.
const NEXT_STEP_MS: Record<string, { ms: number; label: string }> = {
  texted: { ms: 15_000, label: 'Re-text in' },
  retexted: { ms: 10_000, label: 'Call in' },
  called: { ms: 10_000, label: 'Urgent in' },
};

type Bucket = 'urgent' | 'help' | 'waiting' | 'safe' | 'handled';
// Tabs in the order a household moves: waiting for a reply, then urgent or a report, then claimed, then safe.
const BUCKETS: { key: Bucket; label: string; color: string }[] = [
  { key: 'waiting', label: 'No Reply', color: 'var(--grey)' },
  { key: 'urgent', label: 'Urgent', color: 'var(--red)' },
  { key: 'help', label: 'Report', color: 'var(--amber)' },
  { key: 'handled', label: 'Claimed', color: 'var(--blue)' },
  { key: 'safe', label: 'Safe', color: 'var(--green)' },
];

function bucketOf(c: Checkin): Bucket {
  switch (c.state) {
    case 'urgent': return 'urgent';
    case 'needs_help': return 'help';
    case 'safe': return 'safe';
    case 'claimed':
    case 'closed': return 'handled'; // closed only happens when a responder resolves it
    default: return 'waiting'; // texted, retexted, called, and no_reply (storm ended first)
  }
}

const STATE_LABEL: Record<string, string> = {
  texted: 'Alert sent',
  retexted: 'Re-texted',
  called: 'Calling',
  safe: 'Safe',
  needs_help: 'Report',
  urgent: 'Urgent',
  claimed: 'Claimed',
  closed: 'Resolved',
  no_reply: 'No reply',
};


export default function CheckinBoard() {
  const { identity, isActive } = useSpacetimeDB();
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
  const mode = useMode();

  const storm = storms.find((s) => s.active) ?? [...storms].sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  const hh = useMemo(() => new Map(households.map((h) => [h.id, h])), [households]);
  const reqs = useMemo(() => new Map(requests.map((r) => [r.id, r])), [requests]);
  const names = useMemo(() => new Map(responders.map((r) => [r.identity.toHexString(), r.name])), [responders]);

  // Only the latest storm's check-ins count.
  const { mine, counts, rows, tab } = useMemo(() => {
    const list = storm
      ? checkins.filter((c) => c.stormId === storm.id && (mode === 'all' || hh.get(c.householdId)?.real))
      : [];
    const k: Record<Bucket, number> = { urgent: 0, help: 0, waiting: 0, safe: 0, handled: 0 };
    for (const c of list) k[bucketOf(c)]++;
    const tab: Bucket | 'all' = picked ?? (['urgent', 'help', 'waiting'] as Bucket[]).find((b) => k[b] > 0) ?? 'all';
    const shown = tab === 'all' ? [...list] : list.filter((c) => bucketOf(c) === tab);
    const order = ['urgent', 'needs_help', 'called', 'retexted', 'texted', 'no_reply', 'claimed', 'closed', 'safe'];
    shown.sort((a, b) => {
      if (tab === 'help') {
        const ra = reqs.get(a.requestId), rb = reqs.get(b.requestId);
        if (ra && rb) return byLevel(ra, rb);
      }
      if (tab === 'safe' || tab === 'handled') return a.updatedAt.microsSinceUnixEpoch < b.updatedAt.microsSinceUnixEpoch ? 1 : -1;
      // urgent / waiting / all: furthest along the ladder first, then longest waiting
      return order.indexOf(a.state) - order.indexOf(b.state) ||
        (a.updatedAt.microsSinceUnixEpoch < b.updatedAt.microsSinceUnixEpoch ? -1 : 1);
    });
    return { mine: list, counts: k, rows: shown.slice(0, MAX_ROWS), tab };
  }, [checkins, storm, picked, reqs, mode, hh]);

  const total = mine.length;
  const pct = total ? Math.round((counts.safe / total) * 100) : 0;
  const shownTotal = tab === 'all' ? total : counts[tab];

  const selectedC = (selected !== null ? mine.find((c) => c.id === selected) : undefined) ?? rows[0];
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
          <div className="eyebrow">Nobody Missed · Emergency check-ins</div>
          <h1>Check-In Command Center</h1>
        </div>
        <span className="spacer" />
        <span className={`modetag${mode === 'real' ? ' is-real' : ''}`}>{mode === 'real' ? 'Real phones only' : 'Includes fake data'}</span>
        <span className={`live ${isActive ? 'on' : ''}`} role="status">{isActive ? 'Live' : 'Reconnecting…'}</span>
        <StormChip storm={storm} now={now} inZone={total} />
      </header>

      <div className="cols">
        <section className="card queue">
          <div className="qhead">
            <h2>Households in the impact area</h2>
            <div className="qbar">
            <div className="tabs" role="tablist" aria-label="Filter households">
              <button role="tab" aria-selected={tab === 'all'} className={`tab ${tab === 'all' ? 'on' : ''}`} onClick={() => setTab('all')}>
                All <span>{total.toLocaleString()}</span>
              </button>
              {BUCKETS.map((b) => (
                <button key={b.key} role="tab" aria-selected={tab === b.key} className={`tab ${tab === b.key ? 'on' : ''}`} onClick={() => setTab(b.key)}>
                  <b className="dot" style={{ background: b.color }} />{b.label} <span>{counts[b.key].toLocaleString()}</span>
                </button>
              ))}
            </div>
            <span className="qstat">
              <b>{pct}%</b> checked in safe
            </span>
            </div>
          </div>
          <div className="list" role="tabpanel">
            {!ready && <p className="empty">Loading…</p>}
            {ready && !storm && (
              <div className="emptybox">
                <b>No storm yet.</b>
                <span>{households.length.toLocaleString()} households have joined storm alerts. An admin starts a storm from the Dev panel (bottom right).</span>
              </div>
            )}
            {ready && storm && rows.length === 0 && <p className="empty">Nobody in this group.</p>}
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
          {selectedC && (
            <CheckinDetail
              key={selectedC.id.toString()}
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
          <div className="modalbox" role="dialog" aria-modal="true" aria-label="Reset the demo" onClick={(e) => e.stopPropagation()}>
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
  return storm.active
    ? <span className="stormchip on">Storm active · {inZone.toLocaleString()} homes · {mmss(now - tsMs(storm.startedAt))}</span>
    : <span className="simtag">Storm ended</span>;
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

// The list shows why a report ranks where it does ("medical: oxygen"); the full message is in the side panel.
const rowReason = (req: Request) => parseReasons(req.reasons).join(' · ') || req.rawText.split('\n')[0];

const canClaim = (c: Checkin) => !c.claimedBy && ['urgent', 'needs_help', 'texted', 'retexted', 'called', 'no_reply'].includes(c.state);
const canResolve = (c: Checkin, mine: boolean) => c.state === 'urgent' || c.state === 'needs_help' || c.state === 'no_reply' || mine;

const CheckinRow = memo(function CheckinRow({ c, h, req, now, mine, selected, onOpen, onClaim, onRelease, onResolve }: RowProps) {
  const b = bucketOf(c);
  const stop = (fn: (id: bigint) => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(c.id); };
  return (
    <div
      className={`row crow ${selected ? 'selected' : ''}`}
      onClick={() => onOpen(c.id)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(c.id); }}
      tabIndex={0}
      aria-label={`${h?.name ?? 'Household'}: ${STATE_LABEL[c.state] ?? c.state}`}
    >
      <div className="status">
        <span className={`pill b-${b}`}>{STATE_LABEL[c.state] ?? c.state}</span>
        <span className="timer">{nextStep(c, now) || `${mmss(now - tsMs(c.createdAt))} since alert`}</span>
      </div>
      <div className="main">
        <div className="name">{h?.name ?? 'Unknown household'}{h?.real && <span className="realtag">team phone</span>}</div>
        <div className="text">
          {req ? rowReason(req) : h ? `${h.address}, ${h.city}${h.age ? ` · age ${h.age}` : ''}` : ''}
        </div>
      </div>
      <span className="score">{req ? <Level tier={req.tier} /> : b === 'urgent' ? <Level tier="critical" /> : null}</span>
      <div className="actions">
        {canClaim(c) && <button className="btn outline" onClick={stop(onClaim)}>Claim</button>}
        {mine && <button className="btn" onClick={stop(onRelease)}>Release</button>}
        {canResolve(c, mine) && <button className="btn" onClick={stop(onResolve)}>Resolve</button>}
      </div>
    </div>
  );
});

function CheckinDetail({ c, h, req, now, mine, onClaim, onRelease, onResolve }: Omit<RowProps, 'selected' | 'onOpen'>) {
  const [outbox] = useTable(tables.outbox);
  const [calls] = useTable(tables.call);
  const b = bucketOf(c);
  const [chatOpen, setChatOpen] = useState(false);
  const reasons = req ? parseReasons(req.reasons) : [];

  // Step times: the alert is the check-in's own start; later steps only when a real text/call row exists.
  const sent = outbox.filter((o) => o.checkinId === c.id && o.kind === 'send_text').sort((x, y) => tsMs(x.createdAt) - tsMs(y.createdAt));
  const call = calls.filter((x) => x.checkinId === c.id).sort((x, y) => tsMs(y.createdAt) - tsMs(x.createdAt))[0];
  const clock = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
  // A placed call they never picked up stays "not answered", even after someone claims or resolves it.
  const missedCall = c.callsPlaced > 0 && call?.result !== 'answered' && c.reply === '' && c.state !== 'called';
  const steps = [
    { label: c.textsSent >= 2 ? 'Re-texted' : 'Re-text', done: c.textsSent >= 2, bad: false, at: clock(sent[1] ? tsMs(sent[1].createdAt) : undefined) },
    {
      label: c.callsPlaced === 0 ? 'Phone call' : missedCall ? 'Call not answered' : call?.result === 'answered' ? 'Call answered' : 'Calling…',
      done: c.callsPlaced > 0, bad: missedCall, at: clock(call ? tsMs(call.createdAt) : undefined),
    },
  ];

  const timer = nextStep(c, now).replace(/^\D+/, '') || (req ? `${levelOf(req.tier).label} · ${levelOf(req.tier).name}` : b === 'urgent' ? 'P1 · Go now' : '');
  const statusText: Record<Bucket, string> = {
    urgent: 'No contact: welfare check',
    help: 'Needs help',
    waiting: c.state === 'no_reply' ? 'No reply (storm ended)' : 'Waiting for a reply',
    safe: 'Checked in safe',
    handled: c.state === 'closed' ? 'Resolved' : 'Claimed',
  };

  return (
    <aside className="card detail gdetail" aria-label="Household details">
      <div className="ghead">
        <div className="gheadrow">
          <h2>{h?.name ?? 'Unknown household'}</h2>
          <button className="btn" aria-expanded={chatOpen} onClick={() => setChatOpen((v) => !v)}>
            {chatOpen ? 'Hide chat' : 'Chat history'}
          </button>
        </div>
        {h && <div className="gmeta">{h.age ? `${h.age} · ` : ''}{h.address}, {h.city}</div>}
      </div>

      {h && <OnFile h={h} />}

      {chatOpen && (
        <div className="thread" aria-label="Chat history">
          <div className="tout">{STORM_TEXT}<span className="tat">{clock(tsMs(c.createdAt))}</span></div>
          {c.textsSent >= 2 && <div className="tout">{STORM_RETEXT}<span className="tat">{clock(sent[1] ? tsMs(sent[1].createdAt) : undefined)}</span></div>}
          {c.callsPlaced > 0 && <div className={`tcall ${steps[1].bad ? 'bad' : ''}`}>{steps[1].label} {steps[1].at}</div>}
          {c.reply
            ? <div className="tin">{req ? req.rawText : c.reply}</div>
            : <div className="tcall">No reply yet</div>}
        </div>
      )}

      <div className="gsec">
        <div className="glabel">Status</div>
        <div className={`ggroup g-${b}`}>
          <div className="grow">
            <span className={`gicon i-${b}`} aria-hidden="true">
              {b === 'urgent' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M12 8v5M12 17h.01" /><circle cx="12" cy="12" r="10" /></svg>
              ) : b === 'safe' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M5 12l5 5L20 7" /></svg>
              ) : b === 'help' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
              )}
            </span>
            <span className="gtext">{statusText[b]}</span>
            {timer && <span className="gnum">{timer}</span>}
          </div>
        </div>
      </div>

      <div className="gsec">
        <div className="glabel">Steps</div>
        <div className="ggroup">
          <div className="grow"><Check on /><span className="gtext">Alert texted</span><span className="gtime">{clock(tsMs(c.createdAt))}</span></div>
          {steps.map((st) => (
            <div key={st.label} className={`grow ${st.done ? '' : 'dim'}`}>
              {st.bad ? <Cross /> : <Check on={st.done} />}
              <span className="gtext">{st.label}</span>
              <span className="gtime">{st.at}</span>
            </div>
          ))}
        </div>
      </div>

      {req && (
        <div className="gsec">
          <div className="glabel">Their report{reasons.length > 0 ? ` · ${reasons.join(' · ')}` : ''}</div>
          <div className="ggroup gquote">{req.rawText}</div>
        </div>
      )}

      <div className="gactions">
        {canClaim(c) && <button className={`gbtn gb-${b}`} onClick={() => onClaim(c.id)}>{b === 'urgent' ? 'Claim and send someone' : 'Claim'}</button>}
        {mine && <button className="gbtn plain" onClick={() => onRelease(c.id)}>Release</button>}
        {canResolve(c, mine) && <button className="gbtn plain" onClick={() => onResolve(c.id)}>Mark resolved</button>}
      </div>
    </aside>
  );
}

/** What the household told us when they joined (spacetimedb household.profile), so nobody asks again. */
function OnFile({ h }: { h: Household }) {
  if (h.profileStep === 'asked') return <div className="gsec"><div className="glabel">On file</div><div className="ggroup gquote dim">Asked what to know about them; no answer yet.</div></div>;
  if (h.profileStep === 'reading') return <div className="gsec"><div className="glabel">On file</div><div className="ggroup gquote">{h.profileText}<span className="dim"> · reading…</span></div></div>;
  let p: { people?: number | null; medical?: string[]; children?: boolean; pets?: boolean } = {};
  try { p = JSON.parse(h.profile || '{}') ?? {}; } catch { /* keep empty */ }
  const tags = [
    ...(p.people ? [p.people === 1 ? 'lives alone' : `${p.people} people`] : []),
    ...(p.medical ?? []),
    ...(p.children ? ['kids'] : []),
    ...(p.pets ? ['pets'] : []),
  ];
  if (!tags.length && !h.profileText) return null;
  return (
    <div className="gsec">
      <div className="glabel">On file</div>
      <div className="ggroup gquote">
        {tags.length > 0 && <div className="onfile-tags">{tags.map((t) => <span key={t} className="onfile-tag">{t}</span>)}</div>}
        {h.profileText && <div className="onfile-said">“{h.profileText}”</div>}
      </div>
    </div>
  );
}

// The alert texts as the module sends them (spacetimedb/src/rules.ts STORM_TEXT / STORM_RETEXT). Display only.
const STORM_TEXT = 'This is an automated emergency check-in. Reply 1 if you are safe. Reply 2 if you need help.';
const STORM_RETEXT = 'We have not heard from you. Reply 1 if you are safe, 2 if you need help.';

function Check({ on = false }: { on?: boolean }) {
  return on
    ? <svg className="gmark" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#30d158" strokeWidth="2.6" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
    : <span className="gmark empty" aria-hidden="true" />;
}

function Cross() {
  return <svg className="gmark" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff453a" strokeWidth="2.4" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>;
}
