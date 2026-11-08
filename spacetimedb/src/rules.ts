// Pure rules: scoring (SPEC §4 "Scoring rules") and timer decisions (SPEC §4 "State machine", "Timers").
// No SpacetimeDB imports, so `node --test` can run rules.test.ts directly.

// ---------- Timers ----------
export const DEMO = true; // real timers ÷ 60

const MIN = 60_000_000n; // one real minute in micros
const UNIT = DEMO ? MIN / 60n : MIN; // demo: 1 real minute == 1 second

export const T1_CHECKIN: Record<Tier, bigint> = {
  critical: 5n * UNIT,
  high: 10n * UNIT,
  normal: 20n * UNIT,
};
export const T2_CALL: Record<Tier, bigint> = {
  critical: 5n * UNIT,
  high: 10n * UNIT,
  normal: 10n * UNIT,
};
/** After the victim says "1" (still need help), wait this long before the next check-in text.
 *  Longer than the first critical check-in so they aren't texted again right after answering. */
export const T1_AFTER_REPLY = 10n * UNIT;
/** Flag if the call never got placed (bridge down, ElevenLabs refused). */
export const T3_CALL_NOT_PLACED = 5n * UNIT;
/** Safety net for a call that was placed but never reported back. Real seconds: phones ring in real time. */
export const CALL_RESULT_TIMEOUT = 120_000_000n;

// ---------- Escalation ----------
export const ESCALATION_CAP = 20;
export const ESCALATION_STEP = UNIT; // +1 per demo-second (per real minute)
export const FLAG_BONUS = 15;

// ---------- Types ----------
export type Tier = 'critical' | 'high' | 'normal';
export type State =
  | 'new'
  | 'waiting'
  | 'checkin_text_sent'
  | 'call_placed'
  | 'flagged'
  | 'claimed'
  | 'closed';

export interface Facts {
  age?: number | null;
  people?: number | null;
  medical?: string[];
  hazards?: string[];
  children?: boolean;
  location?: string | null;
  quotes?: string[];
}

export const OPEN_UNCLAIMED: State[] = ['new', 'waiting', 'checkin_text_sent', 'call_placed', 'flagged'];

// ---------- Scoring ----------
const POWER_MEDICAL = ['oxygen', 'ventilator', 'dialysis', 'insulin'];
const DANGER = ['trapped', 'flooding', 'rising_water', 'fire', 'collapse', 'structural_collapse', 'injury'];
const UTILITIES = ['no_power', 'no_water'];

const lower = (xs: string[] | undefined) => (xs ?? []).map((x) => String(x).toLowerCase());

export function parseFacts(json: string): Facts {
  try {
    const f = JSON.parse(json);
    return f && typeof f === 'object' ? (f as Facts) : {};
  } catch {
    return {};
  }
}

export function scoreFacts(f: Facts): { baseScore: number; tier: Tier; reasons: string[] } {
  const medical = lower(f.medical);
  const hazards = lower(f.hazards);
  const reasons: string[] = [];
  let base = 10;

  const powerMed = medical.filter((m) => POWER_MEDICAL.includes(m));
  if (powerMed.length) {
    base += 40;
    reasons.push(`medical: ${powerMed.join('+')}`);
  }

  const danger = hazards.filter((h) => DANGER.includes(h));
  if (danger.length) {
    base += 30;
    reasons.push(`danger: ${danger.join('+')}`);
  }

  const vulnerable: string[] = [];
  if (typeof f.age === 'number' && f.age >= 75) vulnerable.push(`age ${f.age}`);
  if (f.children) vulnerable.push('child');
  if (medical.includes('mobility')) vulnerable.push('mobility');
  if (medical.includes('pregnant')) vulnerable.push('pregnant');
  if (vulnerable.length) {
    base += 20;
    reasons.push(`vulnerable: ${vulnerable.join('+')}`);
  }

  const utils = hazards.filter((h) => UTILITIES.includes(h));
  if (utils.length && !powerMed.length) {
    base += 15;
    reasons.push(utils.join('+'));
  }

  if (typeof f.people === 'number' && f.people >= 3) {
    base += 10;
    reasons.push(`${f.people} people`);
  }

  return { baseScore: base, tier: tierFor({ powerMedical: powerMed.length > 0, danger: danger.length > 0, vulnerable: vulnerable.length > 0 }), reasons };
}

// ---------- Priority levels: P1 (critical) / P2 (high) / P3 (normal) ----------
// What responders see. The points above stay only as a hidden tie-breaker.

/**
 * P1 "go now": power-dependent medical, or danger AND a vulnerable person.
 * P2 "go soon": danger, or a vulnerable person.
 * P3 "check when you can": everything else.
 */
export function tierFor(f: { powerMedical: boolean; danger: boolean; vulnerable: boolean }): Tier {
  if (f.powerMedical || (f.danger && f.vulnerable)) return 'critical';
  if (f.danger || f.vulnerable) return 'high';
  return 'normal';
}

/** Shown when Claude could not read the message: it is ranked P2 so a person reads it soon. */
export const UNREAD_REASON = "AI couldn't read this: check it";

/**
 * Waiting moves a report up: P3 becomes P2 after 30 minutes, P2 becomes P1 after 15 minutes more.
 * Real minutes even in DEMO mode: demo seconds would turn every report P1 within a minute.
 */
export const AGE_P3_TO_P2 = 30n * MIN;
export const AGE_P2_TO_P1 = 15n * MIN;

const RANK: Record<Tier, number> = { critical: 1, high: 2, normal: 3 };
const BY_RANK: Tier[] = ['critical', 'critical', 'high', 'normal'];

/**
 * The level a report shows right now.
 * base: level from the facts. read: false if Claude has not read it (failed or still pending) → at least P2.
 * flagged (nobody reached them after text and call) → P1. Then waiting moves it up.
 */
export function levelFor(base: Tier, read: boolean, state: string, waitingMicros: bigint): Tier {
  if (state === 'flagged') return 'critical';
  let rank = RANK[base];
  if (!read) rank = Math.min(rank, 2);
  if (rank === 3 && waitingMicros >= AGE_P3_TO_P2) { rank = 2; waitingMicros -= AGE_P3_TO_P2; }
  if (rank === 2 && waitingMicros >= AGE_P2_TO_P1) rank = 1;
  return BY_RANK[rank];
}

export function escalationFor(sinceCreatedMicros: bigint): number {
  if (sinceCreatedMicros <= 0n) return 0;
  const steps = Number(sinceCreatedMicros / ESCALATION_STEP);
  return Math.min(ESCALATION_CAP, steps);
}

export function totalScore(baseScore: number, escalation: number, state: string): number {
  return baseScore + escalation + (state === 'flagged' ? FLAG_BONUS : 0);
}

// ---------- Tick decisions ----------
export type LatestCall = { result: string; ageMicros: bigint } | null;
export type TickAction = { state: State; outbox?: 'send_text' | 'place_call' } | null;

/**
 * What the 1-second tick should do with one unclaimed request.
 * `sinceStateMicros` = time since the request entered its current state.
 */
export function decideTick(
  state: string,
  tier: Tier,
  sinceStateMicros: bigint,
  latestCall: LatestCall,
  synthetic: boolean,
  afterReply = false // true once a check-in was already sent and the victim answered "1"
): TickAction {
  if (synthetic) return null; // injected load rows only escalate; they never text or call
  const t1 = afterReply && T1_AFTER_REPLY > T1_CHECKIN[tier] ? T1_AFTER_REPLY : T1_CHECKIN[tier];
  if (state === 'waiting' && sinceStateMicros >= t1) {
    return { state: 'checkin_text_sent', outbox: 'send_text' };
  }
  if (state === 'checkin_text_sent' && sinceStateMicros >= T2_CALL[tier]) {
    return { state: 'call_placed', outbox: 'place_call' };
  }
  if (state === 'call_placed') {
    if (!latestCall || latestCall.result === 'failed') {
      if (sinceStateMicros >= T3_CALL_NOT_PLACED) return { state: 'flagged' };
    } else if (sinceStateMicros >= CALL_RESULT_TIMEOUT) {
      return { state: 'flagged' };
    }
  }
  return null;
}

/** Apply a finished call (SPEC §4): answered+2 → closed, answered+1 → waiting, everything else → flagged. */
export function stateAfterCall(result: string, dtmf: string): State {
  const r = result.toLowerCase();
  const d = dtmf.trim();
  if (r === 'answered' && d === '2') return 'closed';
  if (r === 'answered' && d === '1') return 'waiting';
  return 'flagged';
}

/** Victim texted back (SPEC §5 victimReplied): "2" closes, anything else means "still need help". */
export function stateAfterReply(text: string): State {
  return text.trim() === '2' ? 'closed' : 'waiting';
}

export const CHECKIN_TEXT = 'Still need help? Reply 1 yes, 2 no.';

// ---------- Undo (Claim / Resolve) ----------
/** How long a responder can take back a Claim or Resolve. Real seconds, even in demo mode. */
export const UNDO_WINDOW = 30_000_000n;

/** Facts can arrive while a case is claimed; a request put back in "new" after that would never be chased. */
export function requestStateOnUndo(prevState: string, factsStatus: string): string {
  return prevState === 'new' && factsStatus !== 'pending' ? 'waiting' : prevState;
}

/** The ladder only runs during the storm: if it ended meanwhile, a silent household is "no_reply". */
export function checkinStateOnUndo(prevState: string, stormActive: boolean): string {
  return !stormActive && (AWAITING as string[]).includes(prevState) ? 'no_reply' : prevState;
}

// ---------- Storm check-ins (docs/checkin-plan.md) ----------
// We text every household in the storm zone first; silent ones get re-texted, called, then go urgent.

export const STORM_TEXT =
  'This is an automated emergency check-in. Reply 1 if you are safe. Reply 2 if you need help.';
/** The one area every storm hits. Every team phone lives here, plus the fake households. */
export const STORM_AREA = 'Richardson';
/** Fake households alerted per storm (real team phones in the hit cities are always alerted too). */
export const STORM_FAKE_MAX = 20;
/** If a storm starts with too few fake households, seed this many first. */
export const STORM_AUTO_SEED = 100;
export const STORM_RETEXT = 'We have not heard from you. Reply 1 if you are safe, 2 if you need help.';

/** Re-text if no reply to the first alert. */
export const S1_RETEXT = 25n * UNIT;
/** Call if still no reply after the re-text. */
export const S2_CALL = 20n * UNIT;
/** Urgent if the call was never placed / never answered. */
export const S3_URGENT = 20n * UNIT;

export type CheckinState =
  | 'texted' // first alert sent, waiting for a reply
  | 'retexted' // second text sent
  | 'called' // call placed
  | 'safe' // replied 1 / pressed 1
  | 'needs_help' // replied 2 or anything else / pressed 2
  | 'urgent' // no contact after text, re-text and call
  | 'claimed'
  | 'closed' // a responder resolved it
  | 'no_reply'; // the storm ended before they ever answered: still unaccounted for

export const AWAITING: CheckinState[] = ['texted', 'retexted', 'called'];

export type CheckinAction = { state: CheckinState; outbox?: 'send_text' | 'place_call' } | null;

/**
 * What the tick does with one check-in that is still waiting for a reply.
 * `latestCall` is only known for real households; fake ones never answer the phone.
 */
export function decideCheckin(state: string, sinceStateMicros: bigint, latestCall: LatestCall): CheckinAction {
  if (state === 'texted' && sinceStateMicros >= S1_RETEXT) return { state: 'retexted', outbox: 'send_text' };
  if (state === 'retexted' && sinceStateMicros >= S2_CALL) return { state: 'called', outbox: 'place_call' };
  if (state === 'called') {
    if (latestCall && latestCall.result !== 'failed' && latestCall.result !== 'no_answer' && latestCall.result !== 'busy') {
      // Ringing or placing: give the phone time to ring (real seconds).
      if (sinceStateMicros >= CALL_RESULT_TIMEOUT) return { state: 'urgent' };
      return null;
    }
    if (sinceStateMicros >= S3_URGENT) return { state: 'urgent' };
  }
  return null;
}

/** A household texted back during a storm: "1" means safe, anything else means they need help. */
export function checkinAfterReply(text: string): 'safe' | 'needs_help' {
  return text.trim() === '1' ? 'safe' : 'needs_help';
}

/** A finished check-in call: pressed 1 or said safe → safe. Help, or no clear answer → urgent. */
export function checkinAfterCall(result: string, dtmf: string): CheckinState {
  if (result.toLowerCase() !== 'answered') return 'urgent';
  return dtmf.trim() === '1' ? 'safe' : 'urgent';
}

