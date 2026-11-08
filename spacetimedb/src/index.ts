// Nobody Missed — SpacetimeDB module. ALL state, rules, timers and claims live here (SPEC §3–5).
import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { ScheduleAt, Timestamp } from 'spacetimedb';
import {
  STORM_FAKE_MAX,
  STORM_AREA,
  CHECKIN_TEXT,
  OPEN_UNCLAIMED,
  decideTick,
  escalationFor,
  parseFacts,
  scoreFacts,
  levelFor,
  UNREAD_REASON,
  stateAfterCall,
  stateAfterReply,
  totalScore,
  type Tier,
  AWAITING,
  JOIN_REPLY,
  STORM_RETEXT,
  STORM_TEXT,
  checkinAfterCall,
  checkinAfterReply,
  checkinStateOnUndo,
  decideCheckin,
  requestStateOnUndo,
  UNDO_WINDOW,
} from './rules.ts';

// ---------- Tables (SPEC §4) ----------
const request = table(
  {
    name: 'request',
    public: true,
    indexes: [{ accessor: 'byState', algorithm: 'btree', columns: ['state'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    victimHandle: t.string().index('btree'),
    spaceId: t.string(),
    photonSenderId: t.string(),
    platform: t.string(), // "imessage" | "whatsapp" | "sms" | "sim" (victim-sim) | "synthetic" (injectLoad)
    rawText: t.string(),
    facts: t.string(),
    factsStatus: t.string(), // "pending" | "done" | "failed"
    baseScore: t.u32(),
    escalation: t.u32(),
    score: t.u32(),
    tier: t.string(),
    reasons: t.string(), // JSON array
    state: t.string(),
    claimedBy: t.option(t.identity()),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(), // when the request entered its current state (drives T1/T2/T3)
    lastVictimReplyAt: t.timestamp(),
    checkinsSent: t.u32(),
    callsPlaced: t.u32(),
  }
);

const responder = table(
  { name: 'responder', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    online: t.bool(),
  }
);

const outbox = table(
  { name: 'outbox', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    requestId: t.u64().index('btree'),
    kind: t.string(), // "extract_facts" | "send_text" | "place_call"
    payload: t.string(), // JSON
    status: t.string(), // "queued" | "taken" | "done" | "failed" | "cancelled"
    createdAt: t.timestamp(),
    checkinId: t.u64().default(0n), // storm check-in this text/call belongs to (0 = a request's)
  }
);

const call = table(
  { name: 'call', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    requestId: t.u64().index('btree'),
    externalId: t.string(),
    result: t.string(), // "placing" | "ringing" | "answered" | "no_answer" | "busy" | "failed"
    dtmf: t.string(),
    createdAt: t.timestamp(),
    checkinId: t.u64().default(0n), // storm check-in this call belongs to (0 = a request's)
  }
);

const tickTimer = table(
  { name: 'tick_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

// Who may use the dev tools (Inject 2,000, Reset). Hex identities; added by the owner with makeAdmin.
const admin = table(
  { name: 'admin', public: true },
  {
    identityHex: t.string().primaryKey(),
  }
);

/** Switches only Dominic flips. key "calls": "on" lets check-ins place real phone calls (they cost credits). */
const setting = table(
  { name: 'setting', public: true },
  {
    key: t.string().primaryKey(),
    value: t.string(),
  }
);

/** Teammates: can run storms, seed and inject from Dev tools. Only admins (Dominic) can reset or wipe. */
const teammate = table(
  { name: 'teammate', public: true },
  {
    identityHex: t.string().primaryKey(),
  }
);

// ---------- Storm check-ins (docs/checkin-plan.md) ----------
// People we watch over. Fake ones (real=false, platform "synthetic") are never texted or called;
// the tick plays their replies. Real ones are team phones that texted the line once.
const household = table(
  { name: 'household', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string(),
    handle: t.string().index('btree'),
    platform: t.string(),
    spaceId: t.string(),
    photonSenderId: t.string(),
    address: t.string(), // street line
    city: t.string().index('btree'), // a storm hits whole cities
    age: t.u32(),
    policy: t.string(),
    real: t.bool(),
  }
);

const storm = table(
  { name: 'storm', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    cities: t.string(), // affected cities, comma separated, e.g. "Plano, Garland"
    startedAt: t.timestamp(),
    active: t.bool(),
  }
);

const checkin = table(
  {
    name: 'checkin',
    public: true,
    indexes: [{ accessor: 'byState', algorithm: 'btree', columns: ['state'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    stormId: t.u64().index('btree'),
    householdId: t.u64().index('btree'),
    state: t.string(), // texted | retexted | called | safe | needs_help | urgent | claimed | closed | no_reply
    textsSent: t.u32(),
    callsPlaced: t.u32(),
    reply: t.string(), // what they said, if anything
    claimedBy: t.option(t.identity()),
    requestId: t.u64(), // report row once they need help (0 = none)
    simFate: t.string(), // fake households only: "safe" | "help" | "late" (answers after the re-text or call); "" for real
    simReplyAt: t.timestamp(), // fake households only: when they "reply"
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(), // when it entered its current state (drives the ladder)
  }
);

// A Claim or Resolve that can still be taken back: what the case looked like before. One per case
// and action; the tick drops it once the window closes, so a row here means Undo is still available.
const undoAction = table(
  { name: 'undo_action', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    caseKind: t.string(), // "request" | "checkin"
    caseId: t.u64().index('btree'),
    action: t.string(), // "claim" | "resolve"
    actor: t.identity(),
    doneAt: t.timestamp(),
    prevState: t.string(),
    prevUpdatedAt: t.timestamp(),
    // The report a check-in moved along with it ("" = it didn't move one).
    linkedPrevState: t.string(),
    linkedPrevUpdatedAt: t.timestamp(),
    cancelledOutbox: t.array(t.u64()), // queued texts/calls this action stopped
  }
);

const spacetimedb = schema({ request, responder, outbox, call, tickTimer, admin, teammate, setting, household, storm, checkin, undoAction });
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type RequestRow = ReturnType<Ctx['db']['request']['id']['find']> & {};
type UndoRow = ReturnType<Ctx['db']['undoAction']['id']['find']> & {};

// ---------- Helpers ----------
const TICK_MICROS = 1_000_000n;
const now = (ctx: Ctx) => ctx.timestamp.microsSinceUnixEpoch;
const isSynthetic = (r: RequestRow) => r.platform === 'synthetic';

function ensureTick(ctx: Ctx) {
  if (ctx.db.tickTimer.count() === 0n) {
    ctx.db.tickTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(TICK_MICROS) });
  }
}

function enqueue(ctx: Ctx, requestId: bigint, kind: string, payload: object, checkinId = 0n) {
  ctx.db.outbox.insert({
    id: 0n,
    requestId,
    kind,
    payload: JSON.stringify(payload),
    status: 'queued',
    createdAt: ctx.timestamp,
    checkinId,
  });
}

/** The P1/P2/P3 level a report shows now (rules.ts levelFor): from its facts, whether Claude read it, its state and how long it has waited. */
function currentLevel(r: RequestRow, nowMicros: bigint): string {
  const base = scoreFacts(parseFacts(r.facts)).tier;
  return levelFor(base, r.factsStatus === 'done', r.state, nowMicros - r.createdAt.microsSinceUnixEpoch);
}

/** Write a row back with its level and (hidden, tie-breaker only) score recomputed. */
function save(ctx: Ctx, r: RequestRow) {
  r.score = totalScore(r.baseScore, r.escalation, r.state);
  if (r.state !== 'claimed' && r.state !== 'closed') r.tier = currentLevel(r, ctx.timestamp.microsSinceUnixEpoch);
  ctx.db.request.id.update(r);
}

function setState(ctx: Ctx, r: RequestRow, state: string) {
  r.state = state;
  r.updatedAt = ctx.timestamp;
}

/** Returns the outbox rows it stopped, so Undo can send them after all. */
function cancelCheckins(ctx: Ctx, requestId: bigint): bigint[] {
  const cancelled: bigint[] = [];
  for (const o of [...ctx.db.outbox.requestId.filter(requestId)]) {
    if (o.status === 'queued' && o.kind !== 'extract_facts') {
      ctx.db.outbox.id.update({ ...o, status: 'cancelled' });
      cancelled.push(o.id);
    }
  }
  return cancelled;
}

type Snapshot = { state: string; updatedAt: Timestamp };

/** Call after the action, with the case as it was before. Replaces an older undo of the same action. */
function recordUndo(
  ctx: Ctx,
  caseKind: 'request' | 'checkin',
  caseId: bigint,
  action: 'claim' | 'resolve',
  prev: Snapshot,
  linkedPrev: Snapshot | undefined,
  cancelledOutbox: bigint[]
) {
  for (const u of [...ctx.db.undoAction.caseId.filter(caseId)]) {
    if (u.caseKind === caseKind && u.action === action) ctx.db.undoAction.id.delete(u.id);
  }
  ctx.db.undoAction.insert({
    id: 0n,
    caseKind,
    caseId,
    action,
    actor: ctx.sender,
    doneAt: ctx.timestamp,
    prevState: prev.state,
    prevUpdatedAt: prev.updatedAt,
    linkedPrevState: linkedPrev?.state ?? '',
    linkedPrevUpdatedAt: linkedPrev?.updatedAt ?? ctx.timestamp,
    cancelledOutbox,
  });
}

/** Undo only applies while the case is still the way that action left it (not released, resolved since, ...). */
function stillAsLeft(row: { state: string; claimedBy: RequestRow['claimedBy'] }, u: UndoRow) {
  return u.action === 'claim' ? row.state === 'claimed' && !!row.claimedBy?.isEqual(u.actor) : row.state === 'closed';
}

function restoreRequest(ctx: Ctx, r: RequestRow, u: UndoRow, state: string, updatedAt: Timestamp) {
  if (u.action === 'claim') r.claimedBy = undefined; // Resolve never changed who holds the case
  r.state = requestStateOnUndo(state, r.factsStatus);
  r.updatedAt = updatedAt; // the check-in timers carry on from where they were
  save(ctx, r);
}

function restoreOutbox(ctx: Ctx, u: UndoRow) {
  for (const id of u.cancelledOutbox) {
    const o = ctx.db.outbox.id.find(id);
    if (o && o.status === 'cancelled') ctx.db.outbox.id.update({ ...o, status: 'queued' });
  }
}

function getRequest(ctx: Ctx, requestId: bigint): RequestRow {
  const r = ctx.db.request.id.find(requestId);
  if (!r) throw new SenderError(`request ${requestId} not found`);
  return r;
}

function newRequest(
  ctx: Ctx,
  fields: { victimHandle: string; spaceId: string; photonSenderId: string; platform: string; rawText: string }
) {
  return ctx.db.request.insert({
    id: 0n,
    ...fields,
    facts: '{}',
    factsStatus: 'pending',
    baseScore: 10,
    escalation: 0,
    score: 10,
    tier: 'normal',
    reasons: '[]',
    state: 'new',
    claimedBy: undefined,
    createdAt: ctx.timestamp,
    updatedAt: ctx.timestamp,
    lastVictimReplyAt: ctx.timestamp,
    checkinsSent: 0,
    callsPlaced: 0,
  });
}

function applyFacts(r: RequestRow, factsJson: string) {
  const s = scoreFacts(parseFacts(factsJson));
  r.facts = factsJson;
  r.baseScore = s.baseScore;
  r.tier = s.tier;
  r.reasons = JSON.stringify(s.reasons);
}

// ---------- Lifecycle ----------
export const init = spacetimedb.init((ctx) => {
  // Whoever first publishes this database owns it. Only they can open it as a sandbox (openSandbox).
  if (!ctx.db.setting.key.find('publisher')) ctx.db.setting.insert({ key: 'publisher', value: ctx.sender.toHexString() });
  ensureTick(ctx);
});

export const onConnect = spacetimedb.clientConnected((ctx) => {
  ensureTick(ctx);
  const me = ctx.db.responder.identity.find(ctx.sender);
  if (me) ctx.db.responder.identity.update({ ...me, online: true });
});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  const me = ctx.db.responder.identity.find(ctx.sender);
  if (me) ctx.db.responder.identity.update({ ...me, online: false });
});

// ---------- Tick: escalation + T1/T2/T3 (SPEC §4) ----------
export const tick = spacetimedb.reducer({ onSchedule: tickTimer }, { timer: tickTimer.rowType }, (ctx, { timer: _timer }) => {
  const t0 = now(ctx);
  for (const u of [...ctx.db.undoAction.iter()]) {
    if (t0 - u.doneAt.microsSinceUnixEpoch > UNDO_WINDOW) ctx.db.undoAction.id.delete(u.id);
  }
  // Reports opened by a storm check-in ("needs help") are not chased again: the person just answered us.
  const fromStorm = new Set<bigint>();
  for (const c of ctx.db.checkin.iter()) if (c.requestId !== 0n) fromStorm.add(c.requestId);
  for (const state of OPEN_UNCLAIMED) {
    for (const r of [...ctx.db.request.byState.filter(state)]) {
      if (r.claimedBy) continue;
      let changed = false;

      const esc = escalationFor(t0 - r.createdAt.microsSinceUnixEpoch);
      if (esc !== r.escalation) {
        r.escalation = esc;
        changed = true;
      }
      if (currentLevel(r, t0) !== r.tier) changed = true; // waited long enough to move up a level

      let latestCall = null;
      if (r.state === 'call_placed') {
        const calls = [...ctx.db.call.requestId.filter(r.id)].sort((a, b) =>
          a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : -1
        );
        if (calls[0]) latestCall = { result: calls[0].result, ageMicros: t0 - calls[0].createdAt.microsSinceUnixEpoch };
      }

      const action = decideTick(r.state, r.tier as Tier, t0 - r.updatedAt.microsSinceUnixEpoch, latestCall, isSynthetic(r) || fromStorm.has(r.id), r.checkinsSent > 0);
      if (action) {
        setState(ctx, r, action.state);
        if (action.outbox === 'send_text') {
          r.checkinsSent += 1;
          enqueue(ctx, r.id, 'send_text', {
            platform: r.platform,
            to: r.victimHandle,
            spaceId: r.spaceId,
            senderId: r.photonSenderId,
            text: CHECKIN_TEXT,
          });
        } else if (action.outbox === 'place_call') {
          if (callsOn(ctx)) {
            r.callsPlaced += 1;
            enqueue(ctx, r.id, 'place_call', { platform: r.platform, to: r.victimHandle, caseId: r.id.toString() });
          }
        }
        changed = true;
      }

      if (changed) save(ctx, r);
    }
  }
  tickCheckins(ctx);
});

// ---------- Reducers (SPEC §5 table) ----------
export const submitRequest = spacetimedb.reducer(
  { victimHandle: t.string(), spaceId: t.string(), photonSenderId: t.string(), platform: t.string(), rawText: t.string() },
  (ctx, args) => {
    // Storm check-ins (docs/checkin-plan.md): a household's message is first a check-in reply or a JOIN.
    if (routeHouseholdMessage(ctx, args)) return;
    const r = newRequest(ctx, args);
    enqueue(ctx, r.id, 'extract_facts', { text: r.rawText });
  }
);

export const setFacts = spacetimedb.reducer(
  { requestId: t.u64(), factsJson: t.string(), ok: t.bool() },
  (ctx, { requestId, factsJson, ok }) => {
    const r = getRequest(ctx, requestId);
    applyFacts(r, ok ? factsJson : '{}'); // failed extraction is ranked P2, never last: nobody is dropped
    r.factsStatus = ok ? 'done' : 'failed';
    if (!ok) r.reasons = JSON.stringify([UNREAD_REASON]);
    if (r.state === 'new') setState(ctx, r, 'waiting');
    save(ctx, r);
  }
);

export const claimRequest = spacetimedb.reducer({ requestId: t.u64() }, (ctx, { requestId }) => {
  const r = getRequest(ctx, requestId);
  if (r.claimedBy) {
    const who = ctx.db.responder.identity.find(r.claimedBy)?.name ?? 'another responder';
    throw new SenderError(`already taken by ${who}`);
  }
  if (r.state === 'closed') throw new SenderError('request is closed');
  const prev = { state: r.state, updatedAt: r.updatedAt };
  r.claimedBy = ctx.sender;
  setState(ctx, r, 'claimed');
  const cancelled = cancelCheckins(ctx, r.id);
  save(ctx, r);
  recordUndo(ctx, 'request', r.id, 'claim', prev, undefined, cancelled);
});

export const releaseRequest = spacetimedb.reducer({ requestId: t.u64() }, (ctx, { requestId }) => {
  const r = getRequest(ctx, requestId);
  if (!r.claimedBy) return;
  if (!r.claimedBy.isEqual(ctx.sender)) throw new SenderError('only the claimer can release');
  r.claimedBy = undefined;
  setState(ctx, r, 'waiting');
  save(ctx, r);
});

export const resolveRequest = spacetimedb.reducer({ requestId: t.u64() }, (ctx, { requestId }) => {
  const r = getRequest(ctx, requestId);
  const prev = { state: r.state, updatedAt: r.updatedAt };
  setState(ctx, r, 'closed');
  const cancelled = cancelCheckins(ctx, r.id);
  save(ctx, r);
  if (prev.state !== 'closed') recordUndo(ctx, 'request', r.id, 'resolve', prev, undefined, cancelled);
});

/** Take back your own Claim or Resolve, within UNDO_WINDOW. Works for requests and storm check-ins. */
export const undoCase = spacetimedb.reducer({ undoId: t.u64() }, (ctx, { undoId }) => {
  const u = ctx.db.undoAction.id.find(undoId);
  if (!u || now(ctx) - u.doneAt.microsSinceUnixEpoch > UNDO_WINDOW) throw new SenderError('too late to undo');
  if (!u.actor.isEqual(ctx.sender)) throw new SenderError('only the responder who did this can undo it');
  const changed = new SenderError('this case has changed since, so it can no longer be undone');

  if (u.caseKind === 'request') {
    const r = getRequest(ctx, u.caseId);
    if (!stillAsLeft(r, u)) throw changed;
    restoreRequest(ctx, r, u, u.prevState, u.prevUpdatedAt);
    restoreOutbox(ctx, u);
  } else {
    const c = getCheckin(ctx, u.caseId);
    if (!stillAsLeft(c, u)) throw changed;
    const stormActive = !!ctx.db.storm.id.find(c.stormId)?.active;
    if (u.action === 'claim') c.claimedBy = undefined;
    c.state = checkinStateOnUndo(u.prevState, stormActive);
    c.updatedAt = u.prevUpdatedAt;
    ctx.db.checkin.id.update(c);
    const r = u.linkedPrevState && c.requestId !== 0n ? ctx.db.request.id.find(c.requestId) : undefined;
    if (r && stillAsLeft(r, u)) restoreRequest(ctx, r, u, u.linkedPrevState, u.linkedPrevUpdatedAt);
    if (stormActive) restoreOutbox(ctx, u); // nothing from an ended storm goes out later
  }
  ctx.db.undoAction.id.delete(u.id);
});

export const victimReplied = spacetimedb.reducer(
  { victimHandle: t.string(), text: t.string() },
  (ctx, { victimHandle, text }) => {
    const waiting = awaitingCheckinFor(ctx, victimHandle);
    if (waiting) {
      applyCheckinReply(ctx, waiting, text);
      return;
    }
    const open = [...ctx.db.request.victimHandle.filter(victimHandle)]
      .filter((r) => r.state !== 'closed')
      .sort((a, b) => (a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : -1));
    const r = open[0];
    if (!r) throw new SenderError(`no open request for ${victimHandle}`);

    r.lastVictimReplyAt = ctx.timestamp;
    r.rawText = `${r.rawText}\n${text}`;
    if (!r.claimedBy) {
      setState(ctx, r, stateAfterReply(text)); // also resets T1/T2/T3
      cancelCheckins(ctx, r.id);
    }
    if (r.state !== 'closed') {
      r.factsStatus = 'pending';
      enqueue(ctx, r.id, 'extract_facts', { text: r.rawText });
    }
    save(ctx, r);
  }
);

export const takeOutbox = spacetimedb.reducer({ outboxId: t.u64() }, (ctx, { outboxId }) => {
  const o = ctx.db.outbox.id.find(outboxId);
  if (!o) throw new SenderError(`outbox ${outboxId} not found`);
  if (o.status !== 'queued') throw new SenderError(`outbox ${outboxId} is ${o.status}`);
  ctx.db.outbox.id.update({ ...o, status: 'taken' });
});

export const completeOutbox = spacetimedb.reducer(
  { outboxId: t.u64(), ok: t.bool(), externalId: t.string() },
  (ctx, { outboxId, ok, externalId }) => {
    const o = ctx.db.outbox.id.find(outboxId);
    if (!o) throw new SenderError(`outbox ${outboxId} not found`);
    ctx.db.outbox.id.update({ ...o, status: ok ? 'done' : 'failed' });
    if (o.kind === 'place_call') {
      ctx.db.call.insert({
        id: 0n,
        requestId: o.requestId,
        externalId,
        result: ok ? 'placing' : 'failed',
        dtmf: '',
        createdAt: ctx.timestamp,
        checkinId: o.checkinId,
      });
    }
  }
);

export const callResult = spacetimedb.reducer(
  { requestId: t.u64(), result: t.string(), dtmf: t.string() },
  (ctx, { requestId, result, dtmf }) => {
    const calls = [...ctx.db.call.requestId.filter(requestId)].sort((a, b) =>
      a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : -1
    );
    if (calls[0]) ctx.db.call.id.update({ ...calls[0], result, dtmf });

    const r = getRequest(ctx, requestId);
    if (r.state !== 'call_placed') return; // claimed/closed meanwhile: record only
    const next = stateAfterCall(result, dtmf);
    setState(ctx, r, next);
    if (next === 'waiting') r.lastVictimReplyAt = ctx.timestamp;
    save(ctx, r);
  }
);

export const registerResponder = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const clean = name.trim().slice(0, 40);
  if (!clean) throw new SenderError('name required');
  const me = ctx.db.responder.identity.find(ctx.sender);
  if (me) ctx.db.responder.identity.update({ ...me, name: clean, online: true });
  else ctx.db.responder.insert({ identity: ctx.sender, name: clean, online: true });
});

// ---------- Admin (dev tools) ----------
// Dominic's `spacetime login` identity (his terminal). Always an admin; the only one who can add admins.
const OWNER_HEX = 'c200283d09f118ee9b0b658fa4929b296cd5c10374ffb52e3766cf6d1cd76588';

/** A laptop's private local database, opened by its publisher: every Dev tools action is open to anyone. */
function isSandbox(ctx: Ctx) {
  return ctx.db.setting.key.find('sandbox')?.value === 'on';
}

/**
 * For a local database (`npm run sandbox`): lets anyone connected seed, run storms and reset.
 * Only the identity that first published this database can call it, so the shared online one stays locked.
 */
export const openSandbox = spacetimedb.reducer((ctx) => {
  const publisher = ctx.db.setting.key.find('publisher')?.value;
  if (!publisher || publisher !== ctx.sender.toHexString()) throw new SenderError('only the publisher of this database can open it as a sandbox');
  if (ctx.db.setting.key.find('sandbox')) ctx.db.setting.key.update({ key: 'sandbox', value: 'on' });
  else ctx.db.setting.insert({ key: 'sandbox', value: 'on' });
});

function requireAdmin(ctx: Ctx, what: string) {
  const me = ctx.sender.toHexString();
  if (isSandbox(ctx)) return;
  if (me !== OWNER_HEX && !ctx.db.admin.identityHex.find(me)) {
    throw new SenderError(`${what} is locked to admins (ask Dominic)`);
  }
}

/** Teammates and admins: storms, seeding, injecting. */
function requireTeammate(ctx: Ctx, what: string) {
  const me = ctx.sender.toHexString();
  if (isSandbox(ctx)) return;
  if (me !== OWNER_HEX && !ctx.db.admin.identityHex.find(me) && !ctx.db.teammate.identityHex.find(me)) {
    throw new SenderError(`${what} is locked to teammates (send Dominic your Dev id)`);
  }
}

const cleanHex = (s: string) => {
  const hex = s.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new SenderError('not an identity (64 hex characters)');
  return hex;
};

/** Admin (Dominic's browser) adds a teammate from Dev tools. */
export const addTeammate = spacetimedb.reducer({ identityHex: t.string() }, (ctx, { identityHex }) => {
  requireAdmin(ctx, 'Adding teammates');
  const hex = cleanHex(identityHex);
  if (!ctx.db.teammate.identityHex.find(hex)) ctx.db.teammate.insert({ identityHex: hex });
});

export const removeTeammate = spacetimedb.reducer({ identityHex: t.string() }, (ctx, { identityHex }) => {
  requireAdmin(ctx, 'Removing teammates');
  ctx.db.teammate.identityHex.delete(cleanHex(identityHex));
});

/** Real phone calls cost ElevenLabs credits, so they are off unless Dominic turns them on. */
function callsOn(ctx: Ctx) {
  return ctx.db.setting.key.find('calls')?.value === 'on';
}

/** Admin only: turn real check-in calls on or off. Ending a storm turns them off again. */
export const setCalls = spacetimedb.reducer({ on: t.bool() }, (ctx, { on }) => {
  requireAdmin(ctx, 'Turning calls on or off');
  const value = on ? 'on' : 'off';
  if (ctx.db.setting.key.find('calls')) ctx.db.setting.key.update({ key: 'calls', value });
  else ctx.db.setting.insert({ key: 'calls', value });
});

export const makeAdmin = spacetimedb.reducer({ identityHex: t.string() }, (ctx, { identityHex }) => {
  if (ctx.sender.toHexString() !== OWNER_HEX) throw new SenderError('only the owner can add admins');
  const hex = identityHex.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new SenderError('not an identity (64 hex characters)');
  if (!ctx.db.admin.identityHex.find(hex)) ctx.db.admin.insert({ identityHex: hex });
});

export const removeAdmin = spacetimedb.reducer({ identityHex: t.string() }, (ctx, { identityHex }) => {
  if (ctx.sender.toHexString() !== OWNER_HEX) throw new SenderError('only the owner can remove admins');
  ctx.db.admin.identityHex.delete(identityHex.trim().toLowerCase().replace(/^0x/, ''));
});

// ---------- Demo helpers ----------
const SAMPLES: { text: string; facts: object }[] = [
  { text: 'Power out, my dad is on oxygen, he is 79', facts: { age: 79, medical: ['oxygen'], hazards: ['no_power'], quotes: ['Power out', 'on oxygen', 'he is 79'] } },
  { text: 'Water coming into the house, we are trapped upstairs', facts: { hazards: ['flooding', 'trapped'], quotes: ['Water coming into the house', 'trapped upstairs'] } },
  { text: 'No power and no water since yesterday', facts: { hazards: ['no_power', 'no_water'], quotes: ['No power', 'no water'] } },
  { text: 'Family of 5 with a baby, power is out', facts: { people: 5, children: true, hazards: ['no_power'], quotes: ['Family of 5', 'a baby', 'power is out'] } },
  { text: 'Need insulin kept cold, fridge is dead', facts: { medical: ['insulin'], hazards: ['no_power'], quotes: ['insulin', 'fridge is dead'] } },
  { text: 'Tree fell on the roof, part of the ceiling collapsed', facts: { hazards: ['collapse'], quotes: ['ceiling collapsed'] } },
  { text: 'I use a wheelchair and the elevator is out', facts: { medical: ['mobility'], quotes: ['wheelchair', 'elevator is out'] } },
  { text: 'Just checking if shelters are open', facts: { quotes: [] } },
];

export const injectLoad = spacetimedb.reducer({ n: t.u32() }, (ctx, { n }) => {
  requireTeammate(ctx, 'Inject');
  const count = Math.min(n, 5000);
  for (let i = 0; i < count; i++) {
    const s = SAMPLES[ctx.random.integerInRange(0, SAMPLES.length - 1)];
    const r = newRequest(ctx, {
      victimHandle: `synthetic-${i}`,
      spaceId: '',
      photonSenderId: '',
      platform: 'synthetic',
      rawText: s.text,
    });
    applyFacts(r, JSON.stringify(s.facts));
    r.factsStatus = 'done';
    setState(ctx, r, 'waiting');
    save(ctx, r);
  }
});

export const resetDemo = spacetimedb.reducer((ctx) => {
  requireAdmin(ctx, 'Reset');
  for (const r of [...ctx.db.request.iter()]) ctx.db.request.id.delete(r.id);
  for (const o of [...ctx.db.outbox.iter()]) ctx.db.outbox.id.delete(o.id);
  for (const c of [...ctx.db.call.iter()]) ctx.db.call.id.delete(c.id);
  for (const c of [...ctx.db.checkin.iter()]) ctx.db.checkin.id.delete(c.id);
  for (const s of [...ctx.db.storm.iter()]) ctx.db.storm.id.delete(s.id);
});

// ---------- Storm check-ins: logic and reducers (docs/checkin-plan.md) ----------
type CheckinRow = ReturnType<Ctx['db']['checkin']['id']['find']> & {};
type HouseholdRow = ReturnType<Ctx['db']['household']['id']['find']> & {};

const FIRST = ['Maria', 'Harold', 'Dolores', 'Tom', 'Aisha', 'Gary', 'Dev', 'Carla', 'Walt', 'Calvin', 'Janelle', 'Frank',
  'Ruth', 'Marcus', 'Edith', 'Priya', 'Luis', 'Kim', 'Hank', 'Joyce', 'Owen', 'Samir', 'Bea', 'Grace', 'Andre', 'Mei',
  'Rosa', 'Darnell', 'Ingrid', 'Tariq', 'Nora', 'Victor', 'Lena', 'Ike', 'Opal', 'Chen', 'Fatima', 'Rhett', 'Yuki', 'Zora'];
const LAST = ['Alvarez', 'Whitfield', 'Benton', 'Brandt', 'Rahman', 'Nguyen', 'Patel', 'Mendez', 'Pruitt', 'Ortiz', 'Brooks',
  'Kowalski', 'Okafor', 'Hill', 'Larkin', 'Nair', 'Ortega', 'Park', 'Wilder', 'Tran', 'Gallagher', 'Haddad', 'Thompson',
  'Delgado', 'Lee', 'Washington', 'Novak', 'Ibrahim', 'Sato', 'Reyes'];
const STREETS = ['Willow Bend Dr', 'Oak Hollow Ln', 'Creekview Ct', 'Mesa Verde Dr', 'Lakeshore Pl', 'Pecan Grove Rd',
  'Trinity Bend Rd', 'Riverside Ct', 'Cedar Run', 'Elm Fork Dr', 'Heritage St', 'Bluebonnet Ln', 'Park Tower Dr',
  'Maple Crest', 'Sunrise Blvd', 'Willowbrook Ct', 'Prairie Wind Dr', 'Greenbriar Ln', 'Station St', 'Bell Ave'];
const CITIES = ['Plano', 'Richardson', 'Garland', 'Dallas', 'Irving', 'Mesquite', 'Carrollton', 'Frisco', 'Allen', 'Rowlett'];
const POLICIES = ['Home', 'Home + Auto', 'Renters', 'Condo'];

function pick<T>(ctx: Ctx, xs: T[]): T {
  return xs[ctx.random.integerInRange(0, xs.length - 1)];
}
const DEMO_SECOND = 1_000_000n; // fake replies land within real seconds so the demo moves

/** What a fake household says when it needs help: first person, and true to its own record (age). */
function helpMessage(ctx: Ctx, h: HouseholdRow): { text: string; facts: object } {
  const age = h.age || null;
  const options: { text: string; facts: object }[] = [
    { text: "Power out, I'm on oxygen and my backup battery is almost dead", facts: { age, medical: ['oxygen'], hazards: ['no_power'], quotes: ['Power out', 'on oxygen'] } },
    { text: 'Water is coming into the house, we are trapped upstairs', facts: { age, hazards: ['flooding', 'trapped'], quotes: ['Water is coming into the house', 'trapped upstairs'] } },
    { text: 'My insulin needs the fridge and the power is out', facts: { age, medical: ['insulin'], hazards: ['no_power'], quotes: ['insulin', 'power is out'] } },
    { text: 'I use a wheelchair and the elevator is out', facts: { age, medical: ['mobility'], quotes: ['wheelchair', 'elevator is out'] } },
    { text: 'A tree came through the roof and part of the ceiling collapsed', facts: { age, hazards: ['collapse'], quotes: ['ceiling collapsed'] } },
    { text: 'No power and no water since the storm hit', facts: { age, hazards: ['no_power', 'no_water'], quotes: ['No power', 'no water'] } },
  ];
  if (h.age > 0 && h.age <= 50) {
    options.push({ text: "We have a baby and the power is out, it's getting cold", facts: { age, children: true, hazards: ['no_power'], quotes: ['a baby', 'power is out'] } });
  }
  return pick(ctx, options);
}

function activeStorm(ctx: Ctx) {
  for (const s of ctx.db.storm.iter()) if (s.active) return s;
  return undefined;
}

function getCheckin(ctx: Ctx, checkinId: bigint): CheckinRow {
  const c = ctx.db.checkin.id.find(checkinId);
  if (!c) throw new SenderError(`check-in ${checkinId} not found`);
  return c;
}

function setCheckin(ctx: Ctx, c: CheckinRow, state: string) {
  c.state = state;
  c.updatedAt = ctx.timestamp;
}

const isAwaiting = (state: string) => (AWAITING as string[]).includes(state);

function cancelCheckinOutbox(ctx: Ctx, checkinId: bigint): bigint[] {
  const cancelled: bigint[] = [];
  for (const o of [...ctx.db.outbox.iter()]) {
    if (o.checkinId === checkinId && o.status === 'queued') {
      ctx.db.outbox.id.update({ ...o, status: 'cancelled' });
      cancelled.push(o.id);
    }
  }
  return cancelled;
}

/** The check-in still chasing this phone in the active storm, if any. */
function awaitingCheckinFor(ctx: Ctx, handle: string): CheckinRow | undefined {
  const s = activeStorm(ctx);
  if (!s) return undefined;
  for (const h of ctx.db.household.handle.filter(handle)) {
    for (const c of ctx.db.checkin.householdId.filter(h.id)) {
      if (c.stormId === s.id && isAwaiting(c.state)) return c;
    }
  }
  return undefined;
}

/** "Needs help": open a ranked report (the existing request pipeline) for this household. */
function openReport(ctx: Ctx, c: CheckinRow, h: HouseholdRow, text: string) {
  if (c.requestId !== 0n) return;
  const r = newRequest(ctx, {
    victimHandle: h.handle,
    spaceId: h.spaceId,
    photonSenderId: h.photonSenderId,
    platform: h.platform,
    rawText: text,
  });
  if (h.real) {
    enqueue(ctx, r.id, 'extract_facts', { text });
  } else {
    // Fake households "say" a message that fits them, with facts filled in so they rank.
    const s = helpMessage(ctx, h);
    r.rawText = s.text;
    applyFacts(r, JSON.stringify(s.facts));
    r.factsStatus = 'done';
    setState(ctx, r, 'waiting');
    save(ctx, r);
  }
  c.requestId = r.id;
}

function applyCheckinReply(ctx: Ctx, c: CheckinRow, text: string) {
  const h = ctx.db.household.id.find(c.householdId);
  if (!h) throw new SenderError(`household ${c.householdId} not found`);
  c.reply = text;
  cancelCheckinOutbox(ctx, c.id);
  const next = checkinAfterReply(text);
  setCheckin(ctx, c, next);
  if (next === 'needs_help') openReport(ctx, c, h, text.trim() === '2' ? 'Replied 2 to the storm alert: needs help' : text);
  ctx.db.checkin.id.update(c);
}

function latestCheckinCall(ctx: Ctx, checkinId: bigint) {
  return [...ctx.db.call.iter()]
    .filter((x) => x.checkinId === checkinId)
    .sort((a, b) => (a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : -1))[0];
}

/** Every second: walk check-ins still waiting for a reply in the active storm. */
function tickCheckins(ctx: Ctx) {
  const s = activeStorm(ctx);
  if (!s) return;
  const t0 = now(ctx);
  for (const state of AWAITING) {
    for (const c of [...ctx.db.checkin.byState.filter(state)]) {
      if (c.stormId !== s.id || c.claimedBy) continue;
      const h = ctx.db.household.id.find(c.householdId);
      if (!h) continue;

      // Fake households "reply" at their rolled time. "late" ones answer safe after the re-text or the call,
      // so only real team phones go all the way to urgent on stage.
      if (!h.real && t0 >= c.simReplyAt.microsSinceUnixEpoch) {
        applyCheckinReply(ctx, c, c.simFate === 'help' ? '2' : '1');
        continue;
      }

      let latestCall = null;
      if (h.real && c.state === 'called') {
        const call = latestCheckinCall(ctx, c.id);
        if (call) latestCall = { result: call.result, ageMicros: t0 - call.createdAt.microsSinceUnixEpoch };
      }

      const action = decideCheckin(c.state, t0 - c.updatedAt.microsSinceUnixEpoch, latestCall);
      if (!action) continue;
      setCheckin(ctx, c, action.state);
      if (action.outbox === 'send_text') {
        c.textsSent += 1;
        if (h.real) {
          enqueue(ctx, 0n, 'send_text', { platform: h.platform, to: h.handle, spaceId: h.spaceId, senderId: h.photonSenderId, text: STORM_RETEXT }, c.id);
        }
      } else if (action.outbox === 'place_call') {
        if (!h.real || callsOn(ctx)) c.callsPlaced += 1; // calls off: the ladder still turns urgent, nothing rings
        if (h.real && callsOn(ctx)) enqueue(ctx, 0n, 'place_call', { platform: h.platform, to: h.handle, checkinId: c.id.toString() }, c.id);
      }
      ctx.db.checkin.id.update(c);
    }
  }
}

function seedFake(ctx: Ctx, n: number) {
  const count = Math.min(n, 5000);
  const start = Number(ctx.db.household.count());
  for (let i = 0; i < count; i++) {
    ctx.db.household.insert({
      id: 0n,
      name: `${pick(ctx, FIRST)} ${pick(ctx, LAST)}`,
      handle: `household-${start + i}`,
      platform: 'synthetic',
      spaceId: '',
      photonSenderId: '',
      address: `${ctx.random.integerInRange(100, 9999)} ${pick(ctx, STREETS)}`,
      city: STORM_AREA,
      age: ctx.random.integerInRange(19, 94),
      policy: pick(ctx, POLICIES),
      real: false,
    });
  }
}

/** Admin (or the bridge, once it is an admin): a real phone that joined storm alerts. Same handle updates it. */
export const enrollHousehold = spacetimedb.reducer(
  { name: t.string(), handle: t.string(), city: t.string(), platform: t.string(), spaceId: t.string(), photonSenderId: t.string() },
  (ctx, { name, handle, city, platform, spaceId, photonSenderId }) => {
    requireTeammate(ctx, 'Enroll');
    const clean = handle.trim();
    if (!clean) throw new SenderError('phone or handle required');
    const existing = [...ctx.db.household.handle.filter(clean)][0];
    if (existing) {
      ctx.db.household.id.update({
        ...existing, name: name.trim() || existing.name, city: city.trim() || existing.city, platform, spaceId, photonSenderId, real: true,
      });
      return;
    }
    ctx.db.household.insert({
      id: 0n,
      name: name.trim() || clean,
      handle: clean,
      platform,
      spaceId,
      photonSenderId,
      address: 'Team phone',
      city: city.trim() || STORM_AREA,
      age: 0,
      policy: 'Home',
      real: true,
    });
  }
);

/**
 * Admin: forget every team phone so phones can test JOIN again. Removes their check-ins and closes
 * their open reports (so a new JOIN isn't read as a reply). Fake households and storms stay.
 */
export const resetTeamPhones = spacetimedb.reducer((ctx) => {
  requireAdmin(ctx, 'Reset team phones');
  for (const h of [...ctx.db.household.iter()].filter((x) => x.real)) {
    for (const c of [...ctx.db.checkin.householdId.filter(h.id)]) {
      cancelCheckinOutbox(ctx, c.id);
      ctx.db.checkin.id.delete(c.id);
    }
    for (const r of [...ctx.db.request.victimHandle.filter(h.handle)]) {
      if (r.state === 'closed') continue;
      setState(ctx, r, 'closed');
      cancelCheckins(ctx, r.id);
      save(ctx, r);
    }
    ctx.db.household.id.delete(h.id);
  }
});


function closeStorm(ctx: Ctx, stormId: bigint) {
  const row = ctx.db.storm.id.find(stormId);
  if (row) ctx.db.storm.id.update({ ...row, active: false });
  for (const c of [...ctx.db.checkin.stormId.filter(stormId)]) {
    cancelCheckinOutbox(ctx, c.id); // nothing from an ended storm goes out later
    if (isAwaiting(c.state)) {
      setCheckin(ctx, c, 'no_reply'); // not "closed": nobody has reached them
      ctx.db.checkin.id.update(c);
    }
  }
}

/**
 * Admin: a storm hits 2–3 random cities and everyone who lives there gets the alert.
 * If team phones are enrolled, one of their cities is always hit so a demo phone buzzes.
 */
export const startStorm = spacetimedb.reducer((ctx) => {
  requireTeammate(ctx, 'Start storm');
  const old = activeStorm(ctx);
  if (old) closeStorm(ctx, old.id);

  // Every team phone lives in the storm area (older rows may say another city).
  for (const h of [...ctx.db.household.iter()]) {
    if (h.real && h.city !== STORM_AREA) ctx.db.household.id.update({ ...h, city: STORM_AREA });
  }
  const fakesInArea = () => [...ctx.db.household.iter()].filter((h) => !h.real && h.city === STORM_AREA);
  const have = fakesInArea().length;
  if (have < STORM_FAKE_MAX) seedFake(ctx, STORM_FAKE_MAX - have);
  const s = ctx.db.storm.insert({ id: 0n, cities: STORM_AREA, startedAt: ctx.timestamp, active: true });

  // Every team phone, plus at most STORM_FAKE_MAX fake households in the area (random ones). All alerted at once.
  const real = [...ctx.db.household.iter()].filter((h) => h.real);
  const fakes = fakesInArea();
  for (let i = fakes.length - 1; i > 0; i--) {
    const j = ctx.random.integerInRange(0, i);
    [fakes[i], fakes[j]] = [fakes[j], fakes[i]];
  }
  const alerted = [...real, ...fakes.slice(0, STORM_FAKE_MAX)];

  const t0 = now(ctx);
  for (const h of alerted) {
    let simFate = '';
    let replyIn = 0n;
    if (!h.real) {
      const roll = ctx.random();
      simFate = roll < 0.6 ? 'safe' : roll < 0.7 ? 'help' : 'late';
      // late: after the re-text (25 s) and before urgent (65 s), so they visibly come back.
      replyIn = BigInt(simFate === 'late' ? ctx.random.integerInRange(30, 58) : ctx.random.integerInRange(2, 14)) * DEMO_SECOND;
    }
    const c = ctx.db.checkin.insert({
      id: 0n,
      stormId: s.id,
      householdId: h.id,
      state: 'texted',
      textsSent: 1,
      callsPlaced: 0,
      reply: '',
      claimedBy: undefined,
      requestId: 0n,
      simFate,
      simReplyAt: new Timestamp(t0 + replyIn),
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });
    if (h.real) {
      enqueue(ctx, 0n, 'send_text', { platform: h.platform, to: h.handle, spaceId: h.spaceId, senderId: h.photonSenderId, text: STORM_TEXT }, c.id);
    }
  }
});

/** Admin: the storm is over; stop chasing anyone still silent. */
export const endStorm = spacetimedb.reducer((ctx) => {
  requireTeammate(ctx, 'End storm');
  const s = activeStorm(ctx);
  if (s) closeStorm(ctx, s.id);
  const calls = ctx.db.setting.key.find('calls');
  if (calls && calls.value === 'on') ctx.db.setting.key.update({ key: 'calls', value: 'off' });
});

/** A responder takes a household. One winner; chasing stops; its report (if any) is claimed too. */
export const claimCheckin = spacetimedb.reducer({ checkinId: t.u64() }, (ctx, { checkinId }) => {
  const c = getCheckin(ctx, checkinId);
  if (c.claimedBy) {
    const who = ctx.db.responder.identity.find(c.claimedBy)?.name ?? 'another responder';
    throw new SenderError(`already taken by ${who}`);
  }
  if (c.state === 'closed' || c.state === 'safe') throw new SenderError(`check-in is ${c.state}`);
  const prev = { state: c.state, updatedAt: c.updatedAt };
  c.claimedBy = ctx.sender;
  setCheckin(ctx, c, 'claimed');
  const cancelled = cancelCheckinOutbox(ctx, c.id);
  ctx.db.checkin.id.update(c);
  const r = c.requestId !== 0n ? ctx.db.request.id.find(c.requestId) : undefined;
  let linkedPrev: Snapshot | undefined;
  if (r && !r.claimedBy && r.state !== 'closed') {
    linkedPrev = { state: r.state, updatedAt: r.updatedAt };
    r.claimedBy = ctx.sender;
    setState(ctx, r, 'claimed');
    cancelled.push(...cancelCheckins(ctx, r.id));
    save(ctx, r);
  }
  recordUndo(ctx, 'checkin', c.id, 'claim', prev, linkedPrev, cancelled);
});

export const releaseCheckin = spacetimedb.reducer({ checkinId: t.u64() }, (ctx, { checkinId }) => {
  const c = getCheckin(ctx, checkinId);
  if (!c.claimedBy) return;
  if (!c.claimedBy.isEqual(ctx.sender)) throw new SenderError('only the claimer can release');
  c.claimedBy = undefined;
  setCheckin(ctx, c, c.requestId !== 0n ? 'needs_help' : 'urgent');
  ctx.db.checkin.id.update(c);
  const r = c.requestId !== 0n ? ctx.db.request.id.find(c.requestId) : undefined;
  if (r && r.claimedBy && r.claimedBy.isEqual(ctx.sender)) {
    r.claimedBy = undefined;
    setState(ctx, r, 'waiting');
    save(ctx, r);
  }
});

export const resolveCheckin = spacetimedb.reducer({ checkinId: t.u64() }, (ctx, { checkinId }) => {
  const c = getCheckin(ctx, checkinId);
  const prev = { state: c.state, updatedAt: c.updatedAt };
  const cancelled = cancelCheckinOutbox(ctx, c.id);
  setCheckin(ctx, c, 'closed');
  ctx.db.checkin.id.update(c);
  const r = c.requestId !== 0n ? ctx.db.request.id.find(c.requestId) : undefined;
  let linkedPrev: Snapshot | undefined;
  if (r && r.state !== 'closed') {
    linkedPrev = { state: r.state, updatedAt: r.updatedAt };
    setState(ctx, r, 'closed');
    cancelled.push(...cancelCheckins(ctx, r.id));
    save(ctx, r);
  }
  if (prev.state !== 'closed') recordUndo(ctx, 'checkin', c.id, 'resolve', prev, linkedPrev, cancelled);
});

/** /victim-sim: play a household's reply ("1", "2", or any text) without a real phone. */
export const simulateReply = spacetimedb.reducer({ checkinId: t.u64(), text: t.string() }, (ctx, { checkinId, text }) => {
  const c = getCheckin(ctx, checkinId);
  if (!isAwaiting(c.state)) throw new SenderError(`check-in is ${c.state}, not waiting for a reply`);
  applyCheckinReply(ctx, c, text);
});

/** Bridge: result of a check-in call (answered + 1 safe, 2 help; anything else urgent). */
export const checkinCallResult = spacetimedb.reducer(
  { checkinId: t.u64(), result: t.string(), dtmf: t.string() },
  (ctx, { checkinId, result, dtmf }) => {
    const call = latestCheckinCall(ctx, checkinId);
    if (call) ctx.db.call.id.update({ ...call, result, dtmf });
    const c = getCheckin(ctx, checkinId);
    if (c.state !== 'called') return; // claimed/closed meanwhile: record only
    const next = checkinAfterCall(result, dtmf);
    setCheckin(ctx, c, next);
    ctx.db.checkin.id.update(c);
  }
);

/**
 * An inbound message from a phone. Remembers its Photon conversation on its household (so storm
 * alerts can be sent), treats it as the reply to an open check-in, or signs the phone up on "JOIN".
 * Returns true when the message was handled here and should not become a new report.
 */
function routeHouseholdMessage(
  ctx: Ctx,
  m: { victimHandle: string; spaceId: string; photonSenderId: string; platform: string; rawText: string }
): boolean {
  const h = [...ctx.db.household.handle.filter(m.victimHandle)][0];
  if (h && m.platform !== 'sim' && (m.spaceId || m.photonSenderId)) {
    ctx.db.household.id.update({ ...h, platform: m.platform, spaceId: m.spaceId, photonSenderId: m.photonSenderId, real: true });
  }
  const waiting = awaitingCheckinFor(ctx, m.victimHandle);
  if (waiting) {
    applyCheckinReply(ctx, waiting, m.rawText);
    return true;
  }
  // "JOIN" signs the phone up; "JOIN Dorothy" also sets the name the board shows (texting it again renames).
  // Only a short name counts, so a real report that happens to start with "join" is not swallowed.
  const join = /^\s*join(?:\s+([a-z][a-z'.-]*(?:\s+[a-z][a-z'.-]*){0,2}))?\s*$/i.exec(m.rawText);
  if (join) {
    const name = (join[1] ?? '').replace(/\s+/g, ' ').slice(0, 40);
    if (h) {
      if (name) ctx.db.household.id.update({ ...ctx.db.household.id.find(h.id)!, name });
    } else {
      ctx.db.household.insert({
        id: 0n,
        name: name || m.victimHandle,
        handle: m.victimHandle,
        platform: m.platform,
        spaceId: m.spaceId,
        photonSenderId: m.photonSenderId,
        address: 'Team phone',
        city: STORM_AREA,
        age: 0,
        policy: 'Home',
        real: true,
      });
    }
    enqueue(ctx, 0n, 'send_text', { platform: m.platform, to: m.victimHandle, spaceId: m.spaceId, senderId: m.photonSenderId, text: JOIN_REPLY });
    return true;
  }
  return false;
}
