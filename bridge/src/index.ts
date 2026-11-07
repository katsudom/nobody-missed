// Bridge (SPEC §7). Thin: moves events in and drains the outbox. Decides nothing.
// Step 5 (this file): extract_facts -> Claude -> setFacts.
// Later steps add: send_text / place_call (Photon, ElevenLabs) and Photon inbound.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection, tables } from '../../src/module_bindings/index.ts';
import { extractFacts } from './claude.ts';

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

function sweep() {
  for (const o of conn.db.outbox.iter()) {
    if (o.status === 'queued' && o.kind === 'extract_facts') void handleExtract(o);
  }
}

setInterval(sweep, 2000);
conn.db.outbox.onInsert((_ctx, o) => {
  if (o.status === 'queued' && o.kind === 'extract_facts') void handleExtract(o);
});
