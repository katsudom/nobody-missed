// Bridge (SPEC §7). Thin: moves events in and drains the outbox. Decides nothing.
// extract_facts -> Claude -> setFacts.  send_text -> Photon iMessage.  Photon inbound -> submitRequest / victimReplied.
// place_call -> ElevenLabs over the Photon SIP number -> checkinCallResult (storm) / callResult (request).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection, tables } from '../../src/module_bindings/index.ts';
import { extractFacts } from './claude.ts';
import { callsEnabled, placeCall, REQUEST_CALL, STORM_CALL, waitForResult } from './calls.ts';
import { photonEnabled, pollInbound, sendText, type Inbound } from './photon.ts';

const HOST = process.env.SPACETIMEDB_HOST;
const DB = process.env.SPACETIMEDB_DB_NAME;
if (!HOST || !DB) {
  console.error('bridge: set SPACETIMEDB_HOST and SPACETIMEDB_DB_NAME in bridge/.env');
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('bridge: ANTHROPIC_API_KEY is empty in bridge/.env');
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(here, '..', '.spacetimedb-token'); // gitignored
const readToken = () => {
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim() || undefined; } catch { return undefined; }
};

const busy = new Set<string>(); // outbox ids currently being handled (this process)

const conn = DbConnection.builder()
  .withUri(HOST)
  .withDatabaseName(DB)
  .withToken(readToken())
  .withAutomaticReconnect()
  .onConnect((_c, identity, token) => {
    fs.writeFileSync(TOKEN_FILE, token);
    console.log(`bridge: connected to ${DB} as ${identity.toHexString().slice(0, 12)}…`);
    conn.subscriptionBuilder().onApplied(() => { console.log('bridge: subscribed, draining outbox'); sweep(); })
      .subscribe([tables.outbox, tables.request]);
  })
  .onConnectError((_c, err) => console.error('bridge: connect error', err))
  .build();

async function take(id: bigint) {
  try { await conn.reducers.takeOutbox({ outboxId: id }); return true; } catch { return false; }
}

async function handleSendText(o: { id: bigint; requestId: bigint; payload: string }) {
  const key = o.id.toString();
  if (busy.has(key)) return;
  const p = JSON.parse(o.payload) as { platform: string; spaceId: string; senderId: string; text: string };
  if (p.platform === 'imessage' && !photonEnabled()) return; // leave queued until the Photon key is set
  busy.add(key);
  try {
    if (!(await take(o.id))) return;
    let externalId = 'sim'; // victim-sim / test rows: nothing to send, record it as done
    if (p.platform === 'imessage') externalId = await sendText({ outboxId: o.id, spaceId: p.spaceId, senderId: p.senderId, text: p.text });
    await conn.reducers.completeOutbox({ outboxId: o.id, ok: true, externalId });
    console.log(`bridge: request ${o.requestId} check-in text ${p.platform === 'imessage' ? 'sent' : 'recorded (sim)'}`);
  } catch (err) {
    console.error(`bridge: request ${o.requestId} check-in text failed:`, err instanceof Error ? err.message : err);
    await conn.reducers.completeOutbox({ outboxId: o.id, ok: false, externalId: '' }).catch(() => {});
  } finally {
    busy.delete(key);
  }
}

async function handleInbound(m: Inbound) {
  try { await routeInbound(m); } catch (err) {
    console.error('bridge: could not record inbound message:', err instanceof Error ? err.message : err);
  }
}

async function routeInbound(m: Inbound) {
  const open = [...conn.db.request.iter()].some((r) => r.victimHandle === m.handle && r.state !== 'closed');
  if (open) {
    await conn.reducers.victimReplied({ victimHandle: m.handle, text: m.text });
    console.log(`bridge: reply from ${m.handle.slice(0, 5)}… -> victimReplied`);
  } else {
    await conn.reducers.submitRequest({ victimHandle: m.handle, spaceId: m.spaceId, photonSenderId: m.agentUserId, platform: 'imessage', rawText: m.text });
    console.log(`bridge: new request from ${m.handle.slice(0, 5)}… -> submitRequest`);
  }
}

async function handleExtract(o: { id: bigint; requestId: bigint; payload: string }) {
  const key = o.id.toString();
  if (busy.has(key)) return;
  busy.add(key);
  try {
    await conn.reducers.takeOutbox({ outboxId: o.id }); // queued -> taken, so two bridges never double-handle
  } catch {
    busy.delete(key);
    return;
  }
  try {
    const text = (JSON.parse(o.payload) as { text: string }).text;
    const facts = await extractFacts(text);
    await conn.reducers.setFacts({ requestId: o.requestId, factsJson: JSON.stringify(facts), ok: true });
    await conn.reducers.completeOutbox({ outboxId: o.id, ok: true, externalId: '' });
    console.log(`bridge: request ${o.requestId} facts ok (${facts.medical.join('+') || 'no medical'}, ${facts.hazards.join('+') || 'no hazards'})`);
  } catch (err) {
    console.error(`bridge: request ${o.requestId} extraction failed:`, err instanceof Error ? err.message : err);
    // Failed extraction still gets the base score and enters the queue (module's setFacts ok=false).
    try {
      await conn.reducers.setFacts({ requestId: o.requestId, factsJson: '{}', ok: false });
      await conn.reducers.completeOutbox({ outboxId: o.id, ok: false, externalId: '' });
    } catch (e) {
      console.error('bridge: could not report failure', e instanceof Error ? e.message : e);
    }
  } finally {
    busy.delete(key);
  }
}

const CALL_MAX_AGE_MS = 60_000; // older queued calls are leftovers from earlier runs: never ring them

async function handleCall(o: { id: bigint; requestId: bigint; checkinId: bigint; payload: string; createdAt: { microsSinceUnixEpoch: bigint } }) {
  const key = o.id.toString();
  if (busy.has(key) || !callsEnabled()) return; // no ElevenLabs keys: leave queued, the module goes urgent on its own
  if (Date.now() - Number(o.createdAt.microsSinceUnixEpoch / 1000n) > CALL_MAX_AGE_MS) return;
  const p = JSON.parse(o.payload) as { platform: string; to: string; checkinId?: string; caseId?: string };
  const storm = o.checkinId > 0n;
  const label = storm ? `check-in ${o.checkinId}` : `request ${o.requestId}`;
  busy.add(key);
  try {
    if (!(await take(o.id))) return;
    let conversationId: string;
    try {
      conversationId = await placeCall(p.to, storm ? STORM_CALL : REQUEST_CALL, storm ? `checkin-${o.checkinId}` : `request-${o.requestId}`);
    } catch (err) {
      console.error(`bridge: ${label} call failed to start:`, err instanceof Error ? err.message : err);
      await conn.reducers.completeOutbox({ outboxId: o.id, ok: false, externalId: '' }).catch(() => {});
      return;
    }
    await conn.reducers.completeOutbox({ outboxId: o.id, ok: true, externalId: conversationId });
    console.log(`bridge: ${label} calling (${conversationId})`);
    const r = await waitForResult(conversationId);
    if (storm) await conn.reducers.checkinCallResult({ checkinId: o.checkinId, result: r.result, dtmf: r.dtmf });
    else await conn.reducers.callResult({ requestId: o.requestId, result: r.result, dtmf: r.dtmf });
    console.log(`bridge: ${label} call ${r.result}${r.dtmf ? ` pressed ${r.dtmf}` : ''} (${r.seconds}s${r.why ? `, ${r.why}` : ''})`);
  } catch (err) {
    console.error(`bridge: ${label} call error:`, err instanceof Error ? err.message : err);
  } finally {
    busy.delete(key);
  }
}

function handle(o: { id: bigint; requestId: bigint; checkinId: bigint; kind: string; status: string; payload: string; createdAt: { microsSinceUnixEpoch: bigint } }) {
  if (o.status !== 'queued') return;
  if (o.kind === 'extract_facts') void handleExtract(o);
  else if (o.kind === 'send_text') void handleSendText(o);
  else if (o.kind === 'place_call') void handleCall(o);
}

function sweep() {
  for (const o of conn.db.outbox.iter()) handle(o);
}

setInterval(sweep, 2000);
conn.db.outbox.onInsert((_ctx, o) => handle(o));

if (photonEnabled()) {
  let ready = false;
  const startPhoton = () => {
    if (ready) return;
    ready = true;
    pollInbound(path.join(here, '..', '.photon-cursor.json'), handleInbound);
    console.log('bridge: Photon iMessage polling on');
  };
  const wait = setInterval(() => { if (conn.isActive) { clearInterval(wait); setTimeout(startPhoton, 1500); } }, 500);
} else {
  console.log('bridge: PHOTON_API_KEY empty: iMessage off (sim check-ins still recorded)');
}
console.log(callsEnabled() ? 'bridge: ElevenLabs calls on' : 'bridge: ElevenLabs keys empty: calls off (silent check-ins go urgent)');
