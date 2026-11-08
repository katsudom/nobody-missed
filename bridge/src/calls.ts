// ElevenLabs outbound calls through the Photon number (SIP trunk). SPEC §9.
// Place the call, then poll the conversation until it ends and read the result + the 1/2 answer.
const API = 'https://api.elevenlabs.io/v1/convai';
const KEY = process.env.ELEVENLABS_API_KEY ?? '';
const AGENT = process.env.ELEVENLABS_AGENT_ID ?? '';
const NUMBER = process.env.ELEVENLABS_PHONE_NUMBER_ID ?? '';

export const callsEnabled = () => !!(KEY && AGENT && NUMBER);

// What the agent actually says is the first_message set on the ElevenLabs agent; this copy is only passed along.
export const STORM_CALL =
  "This is an automated emergency check-in. If you are safe, press 1 or say I'm safe. If you are not safe, press 2 or say help.";
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

/** A turn longer than this is background conversation, not an answer to the question. */
const MAX_ANSWER_WORDS = 6;

/**
 * One turn of speech or keypad input -> "1" (safe), "2" (help) or "" (not an answer).
 * "not safe" is checked first so it never counts as "safe". Yes/no are not accepted: bystanders say them constantly.
 */
function answerFrom(turn: string): string {
  const t = turn.toLowerCase().trim();
  if (!t || t.split(/\s+/).length > MAX_ANSWER_WORDS) return '';
  if (/\b(not safe|unsafe|help|2|two)\b/.test(t)) return '2';
  if (/\b(safe|1|one)\b/.test(t)) return '1';
  return '';
}

/** The person's first clear answer in the call; long stretches of background talk are skipped. */
export function digitFrom(userTurns: string[]): string {
  for (const turn of userTurns) {
    const a = answerFrom(turn);
    if (a) return a;
  }
  return '';
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

  const turns = (c.transcript ?? []).filter((t) => t.role === 'user').map((t) => t.message ?? '');
  const said = turns.join(' ');
  const raw = c.metadata?.phone_call?.call_result ?? (said.trim() ? 'answered' : c.status === 'failed' ? 'failed' : 'no_answer');
  const result = raw === 'voicemail' ? 'no_answer' : raw;
  return {
    result,
    dtmf: result === 'answered' ? digitFrom(turns) : '',
    seconds: c.metadata?.call_duration_secs ?? 0,
    why: c.metadata?.termination_reason ?? '',
  };
}
