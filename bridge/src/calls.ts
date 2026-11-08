// ElevenLabs outbound calls through the Photon number (SIP trunk). SPEC §9.
// Place the call, then poll the conversation until it ends and read the result + the 1/2 answer.
const API = 'https://api.elevenlabs.io/v1/convai';
const KEY = process.env.ELEVENLABS_API_KEY ?? '';
const AGENT = process.env.ELEVENLABS_AGENT_ID ?? '';
const NUMBER = process.env.ELEVENLABS_PHONE_NUMBER_ID ?? '';

export const callsEnabled = () => !!(KEY && AGENT && NUMBER);

// The agent's first message in the ElevenLabs dashboard is {{first_message}}; the bridge fills it in.
// Both scripts keep the same keys: 1 / yes, 2 / no.
export const STORM_CALL =
  'This is an automated emergency check-in. If you are safe, press 1 or say yes. If you need help, press 2 or say no.';
export const REQUEST_CALL =
  'This is an automated check-in from the disaster help line. If you still need help, press 1 or say yes. If you are okay, press 2 or say no.';

const headers = { 'xi-api-key': KEY, 'Content-Type': 'application/json' };

/** Start the call. Returns the ElevenLabs conversation id. */
export async function placeCall(to: string, firstMessage: string, ref: string): Promise<string> {
  if (!/^\+\d{8,15}$/.test(to)) throw new Error(`not a phone number in +1... form (${to.slice(0, 4)}…)`);
  const res = await fetch(`${API}/sip-trunk/outbound-call`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      agent_id: AGENT,
      agent_phone_number_id: NUMBER,
      to_number: to,
      conversation_initiation_client_data: { dynamic_variables: { first_message: firstMessage, case_id: ref } },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; conversation_id?: string | null; detail?: unknown };
  if (!res.ok || body.success === false || !body.conversation_id) {
    throw new Error(`ElevenLabs ${res.status}: ${body.message ?? JSON.stringify(body.detail ?? body).slice(0, 300)}`);
  }
  return body.conversation_id;
}

type Conversation = {
  status: 'initiated' | 'in-progress' | 'processing' | 'done' | 'failed';
  transcript?: { role: 'user' | 'agent'; message: string | null }[];
  user_message_count?: number | null;
  metadata?: { call_duration_secs?: number; termination_reason?: string; phone_call?: { call_result?: string | null } | null };
};

/** "1"/"one"/"yes" -> 1, "2"/"two"/"no" -> 2, first answer the person gave. */
export function digitFrom(userText: string): string {
  const m = userText.toLowerCase().match(/\b(1|one|yes|yeah|yep|2|two|no|nope)\b/);
  if (!m) return '';
  return ['1', 'one', 'yes', 'yeah', 'yep'].includes(m[1]) ? '1' : '2';
}

export type CallOutcome = { result: string; dtmf: string; seconds: number; why: string };

/** Poll every 3 s until the call is over (max ~4 min). Voicemail counts as no answer. */
export async function waitForResult(conversationId: string): Promise<CallOutcome> {
  const deadline = Date.now() + 240_000;
  let c: Conversation | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${API}/conversations/${conversationId}`, { headers });
    if (!res.ok) continue; // not visible yet / blip
    c = (await res.json()) as Conversation;
    if (c.status === 'done' || c.status === 'failed') break;
  }
  if (!c || (c.status !== 'done' && c.status !== 'failed')) return { result: 'failed', dtmf: '', seconds: 0, why: 'no result in 4 min' };

  const said = (c.transcript ?? []).filter((t) => t.role === 'user').map((t) => t.message ?? '').join(' ');
  const raw = c.metadata?.phone_call?.call_result ?? (said.trim() ? 'answered' : c.status === 'failed' ? 'failed' : 'no_answer');
  const result = raw === 'voicemail' ? 'no_answer' : raw;
  return {
    result,
    dtmf: result === 'answered' ? digitFrom(said) : '',
    seconds: c.metadata?.call_duration_secs ?? 0,
    why: c.metadata?.termination_reason ?? '',
  };
}
