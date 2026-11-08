// Photon (SPEC §7–8): inbound iMessages in, check-in texts out. REST only, polling like Photon's own quickstart.
import fs from 'node:fs';

const API = 'https://api.photon.codes/v1';
const PROJECT = process.env.PHOTON_PROJECT_ID ?? '';
const KEY = process.env.PHOTON_API_KEY ?? '';

export const photonEnabled = () => !!(PROJECT && KEY);

const headers = (extra: Record<string, string> = {}) => ({
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  ...extra,
});

export interface Inbound {
  id: string;
  handle: string; // victim phone / email
  spaceId: string;
  agentUserId: string; // our side of the conversation; used as senderId when replying
  text: string;
  createdAt: string;
}

// ---- cursor (which messages we've already handled), kept on disk so restarts don't double-submit ----
type Cursor = { since: string; seen: string[] };
function loadCursor(file: string): Cursor {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Cursor;
  } catch {
    return { since: new Date(Date.now() - 10_000).toISOString(), seen: [] };
  }
}

/** Poll received iMessages every 2 s and hand each new one to `onMessage` (oldest first). */
export function pollInbound(cursorFile: string, onMessage: (m: Inbound) => Promise<void>) {
  const cur = loadCursor(cursorFile);
  const seen = new Set(cur.seen);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      let pageToken: string | undefined;
      do {
        const q = new URLSearchParams({
          direction: 'received',
          platform: 'imessage',
          order: 'asc',
          pageSize: '100',
          createdSince: cur.since,
        });
        if (pageToken) q.set('pageToken', pageToken);
        const res = await fetch(`${API}/projects/${PROJECT}/messages?${q}`, { headers: headers() });
        if (!res.ok) throw new Error(`list messages ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const page = (await res.json()) as { items: any[]; nextPageToken?: string };

        for (const m of page.items) {
          if (seen.has(m.id)) continue;
          const text = m.content?.type === 'text' ? String(m.content.text ?? '').trim() : '';
          const handle = m.sentBy?.handle;
          // receivedBy is optional in Photon's schema: fall back to addressedTo, then the other person in the space.
          const agentId: string | undefined =
            m.receivedBy?.id ??
            m.addressedTo?.id ??
            (m.space?.participantIds as string[] | undefined)?.find((p) => p !== m.sentBy?.id);
          const isOwn = m.sentBy?.id && m.sentBy.id === agentId;
          if (text && handle && agentId && m.space?.id && !isOwn) {
            await onMessage({ id: m.id, handle, spaceId: m.space.id, agentUserId: agentId, text, createdAt: m.createdAt });
          } else if (!isOwn) {
            console.log(`bridge: skipped Photon message ${m.id} (type=${m.content?.type}, handle=${!!handle}, agent=${!!agentId}, space=${!!m.space?.id})`);
          }
          seen.add(m.id);
          if (m.createdAt > cur.since) cur.since = m.createdAt;
        }
        pageToken = page.nextPageToken;
      } while (pageToken);

      cur.seen = [...seen].slice(-500);
      fs.writeFileSync(cursorFile, JSON.stringify(cur));
    } catch (err) {
      console.error('bridge: photon poll failed:', err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };

  void tick();
  setInterval(tick, 2000);
}

/** Send a plain-text iMessage. Returns Photon's message id. 202 = accepted, not yet delivered. */
export async function sendText(o: { outboxId: bigint; spaceId: string; senderId: string; text: string }) {
  const res = await fetch(`${API}/projects/${PROJECT}/messages`, {
    method: 'POST',
    headers: headers({ 'idempotency-key': `outbox-${o.outboxId}` }),
    body: JSON.stringify({
      spaceId: o.spaceId,
      senderId: o.senderId,
      content: { type: 'text', format: 'plain', text: o.text },
    }),
  });
  if (!res.ok) throw new Error(`send ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json().catch(() => ({}))) as { id?: string };
  return body.id ?? '';
}
