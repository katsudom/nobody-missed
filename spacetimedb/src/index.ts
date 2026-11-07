// Nobody Missed — SpacetimeDB module. ALL state, rules, timers and claims live here (SPEC §3–5).
import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import {
  CHECKIN_TEXT,
  OPEN_UNCLAIMED,
  decideTick,
  escalationFor,
  parseFacts,
  scoreFacts,
  stateAfterCall,
  stateAfterReply,
  totalScore,
  type Tier,
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
  }
);

const tickTimer = table(
  { name: 'tick_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

const spacetimedb = schema({ request, responder, outbox, call, tickTimer });
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type RequestRow = ReturnType<Ctx['db']['request']['id']['find']> & {};

// ---------- Helpers ----------
const TICK_MICROS = 1_000_000n;
const now = (ctx: Ctx) => ctx.timestamp.microsSinceUnixEpoch;
const isSynthetic = (r: RequestRow) => r.platform === 'synthetic';

function ensureTick(ctx: Ctx) {
  if (ctx.db.tickTimer.count() === 0n) {
    ctx.db.tickTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(TICK_MICROS) });
  }
}

function enqueue(ctx: Ctx, requestId: bigint, kind: string, payload: object) {
  ctx.db.outbox.insert({
    id: 0n,
    requestId,
    kind,
    payload: JSON.stringify(payload),
    status: 'queued',
    createdAt: ctx.timestamp,
  });
}

/** Write a row back with score recomputed. */
function save(ctx: Ctx, r: RequestRow) {
  r.score = totalScore(r.baseScore, r.escalation, r.state);
  ctx.db.request.id.update(r);
}

function setState(ctx: Ctx, r: RequestRow, state: string) {
  r.state = state;
  r.updatedAt = ctx.timestamp;
}

function cancelCheckins(ctx: Ctx, requestId: bigint) {
  for (const o of [...ctx.db.outbox.requestId.filter(requestId)]) {
    if (o.status === 'queued' && o.kind !== 'extract_facts') {
      ctx.db.outbox.id.update({ ...o, status: 'cancelled' });
    }
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
  for (const state of OPEN_UNCLAIMED) {
    for (const r of [...ctx.db.request.byState.filter(state)]) {
      if (r.claimedBy) continue;
      let changed = false;

      const esc = escalationFor(t0 - r.createdAt.microsSinceUnixEpoch);
      if (esc !== r.escalation) {
        r.escalation = esc;
        changed = true;
      }

      let latestCall = null;
      if (r.state === 'call_placed') {
        const calls = [...ctx.db.call.requestId.filter(r.id)].sort((a, b) =>
          a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : -1
        );
        if (calls[0]) latestCall = { result: calls[0].result, ageMicros: t0 - calls[0].createdAt.microsSinceUnixEpoch };
      }

      const action = decideTick(r.state, r.tier as Tier, t0 - r.updatedAt.microsSinceUnixEpoch, latestCall, isSynthetic(r));
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
          r.callsPlaced += 1;
          enqueue(ctx, r.id, 'place_call', { platform: r.platform, to: r.victimHandle, caseId: r.id.toString() });
        }
        changed = true;
      }

      if (changed) save(ctx, r);
    }
  }
});

// ---------- Reducers (SPEC §5 table) ----------
export const submitRequest = spacetimedb.reducer(
  { victimHandle: t.string(), spaceId: t.string(), photonSenderId: t.string(), platform: t.string(), rawText: t.string() },
  (ctx, args) => {
    const r = newRequest(ctx, args);
    enqueue(ctx, r.id, 'extract_facts', { text: r.rawText });
  }
);

export const setFacts = spacetimedb.reducer(
  { requestId: t.u64(), factsJson: t.string(), ok: t.bool() },
  (ctx, { requestId, factsJson, ok }) => {
    const r = getRequest(ctx, requestId);
    applyFacts(r, ok ? factsJson : '{}'); // failed extraction still gets base score — nobody is dropped
    r.factsStatus = ok ? 'done' : 'failed';
    if (r.state === 'new') setState(ctx, r, 'waiting');
    save(ctx, r);
  }
);

export const claimRequest = spacetimedb.reducer({ requestId: t.u64() }, (ctx, { requestId }) => {
  const r = getRequest(ctx, requestId);
  if (r.claimedBy) {
    const who = ctx.db.responder.identity.find(r.claimedBy)?.name ?? 'another responder';
    throw new SenderError(`already claimed by ${who}`);
  }
  if (r.state === 'closed') throw new SenderError('request is closed');
  r.claimedBy = ctx.sender;
  setState(ctx, r, 'claimed');
  cancelCheckins(ctx, r.id);
  save(ctx, r);
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
  setState(ctx, r, 'closed');
  cancelCheckins(ctx, r.id);
  save(ctx, r);
});

export const victimReplied = spacetimedb.reducer(
  { victimHandle: t.string(), text: t.string() },
  (ctx, { victimHandle, text }) => {
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

// Parked until the team is ready for the load demo (SPEC §2 step 4). Flip to true and republish.
const INJECT_ENABLED = false;

export const injectLoad = spacetimedb.reducer({ n: t.u32() }, (ctx, { n }) => {
  if (!INJECT_ENABLED) throw new SenderError('Inject is parked for now (ask Dominic)');
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

// Dominic's `spacetime login` identity. Only this identity (his terminal) can reset the shared database.
const OWNER_HEX = 'c200283d09f118ee9b0b658fa4929b296cd5c10374ffb52e3766cf6d1cd76588';

export const resetDemo = spacetimedb.reducer((ctx) => {
  if (ctx.sender.toHexString() !== OWNER_HEX) throw new SenderError('Reset is locked (ask Dominic)');
  for (const r of [...ctx.db.request.iter()]) ctx.db.request.id.delete(r.id);
  for (const o of [...ctx.db.outbox.iter()]) ctx.db.outbox.id.delete(o.id);
  for (const c of [...ctx.db.call.iter()]) ctx.db.call.id.delete(c.id);
});
