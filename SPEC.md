# Nobody Missed — Team Spec (HackUTD 2026: Zero Day)

**Pitch:** Victims text one number for help. If they go quiet, we text, then call, then flag a human. Responders use one live board.
**Tracks:** State Farm "The Worst Day, at Scale" · Spacetime Main Track · Photon.
**One rule for every feature:** does it help make sure nobody is overlooked? If not, cut it.

---

## 1. The flow (7 steps, memorize this)

1. Victim texts the Photon line: "Mom is 82, on oxygen, power's out."
2. Board ranks it and shows why (highlighted words + the rule that fired).
3. Nobody claims it, so its priority climbs over time (capped).
4. Victim gets a check-in text: "Still need help? Reply 1 yes, 2 no."
5. No reply, so the phone rings (automated voice check-in, press 1 / 2).
6. No answer, so the case turns red: "needs welfare check" for a human.
7. A responder claims it at any point. Only one can win. Check-ins stop.

**Demo timers = real timers ÷ 60.** Real: check-in text at 5 min (critical) / 20 min (normal), call 5–10 min later, flag 5–15 min after that. Demo: ~10 s, ~10 s, ~10 s.

## 2. Demo script (2 minutes)

| # | What happens | Screen |
|---|---|---|
| 1 | Teammate texts a request from their phone | Appears ranked on projector, words highlighted |
| 2 | Two responder tabs click Claim on the same case | Only one wins, other gets "already claimed" |
| 3 | Ignore a case: check-in text arrives on phone, ignored → phone rings on stage → ignored → row turns red | Phone held up, board updates |
| 4 | Press "Inject 2,000" | Board stays live, teammate's cases still ranked right |

Pitch line: "Everyone ranks requests. We chase the people who stop answering."

---

## 3. Architecture (3 pieces, nothing else)

```
 Victim phone (iMessage / WhatsApp)          Responder laptop (React)
        │  ▲                                        │  ▲
        ▼  │                                        ▼  │
   ┌──────────────┐    reducers / subscriptions  ┌─────────────────────────┐
   │ Photon API   │◄────────┐      ┌────────────►│  SPACETIME (Maincloud)  │
   └──────────────┘         │      │             │  ALL state, ALL rules,  │
        ▲  │           ┌────┴──────┴────┐        │  ALL timers, claims     │
        │  ▼           │  bridge (Node) │        └─────────────────────────┘
   ┌──────────────┐    │  thin: moves   │
   │ ElevenLabs   │◄───┤  events in/out │──► Claude API (fact extraction only)
   │ (SIP→Photon) │    └────────────────┘
   └──────────────┘
```

- **Spacetime is the backend.** Tables, reducers, scheduled reducers, claim atomicity, escalation, state machine. No other database, no Express server. (Spacetime judges told you this is what they score.)
- **`src/` (web)** React responder board. Subscribes to tables, calls reducers. No business logic.
- **`bridge/`** one Node process. It only (a) turns Photon inbound messages/call events into reducer calls, (b) drains an `outbox` table and performs the side effect (send text, place call, call Claude). It decides nothing. If the bridge dies, the board still works.

Why a bridge: scheduled reducers run in a transaction and cannot do HTTP. Spacetime procedures can do `ctx.http.fetch` but cannot be scheduled. So Spacetime writes "intent" rows into `outbox`; the bridge executes them and reports back with a reducer.

---

## 4. Data model (Spacetime, TypeScript module)

### Tables

```ts
// spacetimedb/src/index.ts  (names snake_case, accessors camelCase on client)
request {
  id: u64 pk autoInc
  victimHandle: string        // E.164 phone or email handle, index
  spaceId: string             // Photon space id (conversation)
  photonSenderId: string      // Photon user id our agent sends AS (receivedBy.id of inbound msg)
  platform: string            // "imessage" | "whatsapp" | "sms"
  rawText: string
  facts: string               // JSON from Claude: {age, medical[], hazards[], people, location, quotes[]}
  factsStatus: string         // "pending" | "done" | "failed"
  baseScore: u32              // from rules
  escalation: u32             // 0..ESCALATION_CAP, grows while unclaimed
  score: u32                  // baseScore + escalation (+ flag bonus); board sorts by this desc
  tier: string                // "critical" | "high" | "normal"
  reasons: string             // JSON array of rule names that fired, e.g. ["oxygen+no_power","age>75"]
  state: string               // see state machine
  claimedBy: option<identity>
  createdAt: timestamp
  updatedAt: timestamp
  lastVictimReplyAt: timestamp
  checkinsSent: u32
  callsPlaced: u32
}

responder { identity pk, name string, online bool }

outbox {                       // Spacetime → bridge work queue
  id: u64 pk autoInc
  requestId: u64 index
  kind: string                 // "extract_facts" | "send_text" | "place_call"
  payload: string              // JSON (text to send, etc.)
  status: string               // "queued" | "taken" | "done" | "failed"
  createdAt: timestamp
}

call {                         // one row per attempt
  id: u64 pk autoInc
  requestId: u64 index
  externalId: string           // ElevenLabs conversation_id (or Twilio SID)
  result: string               // "placing" | "ringing" | "answered" | "no_answer" | "busy" | "failed"
  dtmf: string                 // "1" / "2" / ""
  createdAt: timestamp
}

tick_timer { scheduledId u64 pk autoInc, scheduledAt scheduleAt }   // every 1000ms
```

### State machine (`request.state`)

```
new ──(facts done)──► waiting ──(unclaimed > T1)──► checkin_text_sent
                                                          │
            ┌──── reply "2" ──► closed                    │ (no reply > T2)
            │                                             ▼
            ├──── reply "1" ──► waiting (timers reset)  call_placed
            │                                             │
            │        ┌── answered + dtmf "2" ──► closed   │
            │        ├── answered + dtmf "1" ──► waiting  │
            │        └── no_answer / busy / failed ───────┴──► flagged  (red, "needs welfare check")
            │
   any state ──(claim)──► claimed  (all check-ins stop)   claimed ──(resolve)──► closed
```

### Scoring rules (plain if-statements, ALL shown on one slide)

```
base = 10
+40  medical dependency on power (oxygen, ventilator, dialysis, insulin/fridge)
+30  trapped / rising water / fire / structural collapse / injury
+20  age >= 75  or  infant/child present  or  mobility impaired  or  pregnant
+15  no power / no water (without medical dependency)
+10  multiple people (>= 3)
-> tier: >= 60 critical, >= 30 high, else normal

escalation: +1 per demo-second (per real minute) while unclaimed, capped at 20
flagged bonus: +15  (silence raises it, but a flagged normal case can never outrank a confirmed critical one — the cap guarantees this)
score = base + escalation + flagBonus
```

Facts come from the victim's own words. Every reason shows the quoted words. Nothing is estimated.

### Timers (constants at top of module; `DEMO=true` divides by 60)

```
T1 check-in text after unclaimed:   critical 5 min, high 10 min, normal 20 min
T2 call after no reply to text:     5 min (critical) / 10 min
T3 flag after no answer to call:    immediately on no_answer; or 5 min if call failed to place
```

---

## 5. Spacetime module — what to build

Use the TypeScript server API (SpacetimeDB 2.x). Key syntax (from the official `typescript-server` skill):

```ts
import { schema, table, t } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';   // root package, NOT /server

const request = table({ name: 'request', public: true,
  indexes: [{ accessor: 'byState', algorithm: 'btree', columns: ['state'] }] }, {
  id: t.u64().primaryKey().autoInc(),
  victimHandle: t.string().index('btree'),
  // ...see §4
});
const tickTimer = table({ name: 'tick_timer' }, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
});
const spacetimedb = schema({ request, responder, outbox, call, tickTimer });
export default spacetimedb;

export const init = spacetimedb.init((ctx) => {
  ctx.db.tickTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(1_000_000n) }); // 1s, micros
});

export const tick = spacetimedb.reducer({ onSchedule: tickTimer }, { timer: tickTimer.rowType }, (ctx, { timer }) => {
  // for each request in waiting/checkin_text_sent/call_placed: advance escalation, fire T1/T2/T3 transitions,
  // insert outbox rows ("send_text", "place_call"), recompute score.
});
```

### Reducers (exact list — this is the whole API the web app and bridge use)

| Reducer | Caller | Args | Does |
|---|---|---|---|
| `submitRequest` | bridge | victimHandle, spaceId, photonSenderId, platform, rawText | insert `request` state=new, insert outbox `extract_facts` |
| `setFacts` | bridge | requestId, factsJson, ok | store facts, run rules → baseScore/tier/reasons, state=waiting |
| `claimRequest` | web | requestId | if claimedBy is set → throw "already claimed"; else set claimedBy=ctx.sender, state=claimed. **Atomic by construction** (reducer = transaction) |
| `releaseRequest` | web | requestId | unclaim |
| `resolveRequest` | web | requestId | state=closed |
| `victimReplied` | bridge | victimHandle, text | find open request by handle; "2"→closed, "1"/anything→waiting, reset timers, lastVictimReplyAt=now, append text to rawText & re-queue extract_facts |
| `takeOutbox` | bridge | outboxId | status queued→taken (so two bridge instances never double-send) |
| `completeOutbox` | bridge | outboxId, ok, externalId | status done/failed; for place_call also insert `call` row |
| `callResult` | bridge | requestId, result, dtmf | update `call` row; apply state machine (§4) |
| `registerResponder` | web | name | upsert responder for ctx.sender |
| `injectLoad` | web | n | insert n synthetic requests with pre-filled facts (skips Claude) — the 2,000 button |
| `resetDemo` | web | — | delete everything except responders (rehearsal) |

Gotchas from the skill: every reducer/hook must be `export const`; use `0n` for autoInc; spread `iter()`/`filter()` before `.sort()`; `ctx.timestamp.microsSinceUnixEpoch` is a bigint; don't put `.default()` on pk columns.

### Commands

```bash
# install CLI (Windows PowerShell):  iwr https://windows.spacetimedb.com -useb | iex
# mac/linux:                         curl -sSf https://install.spacetimedb.com | sh
spacetime dev --template react-ts          # local server + publish + bindings + vite, all in one
spacetime login                            # GitHub/Google, once per teammate
spacetime publish nobody-missed --server maincloud
spacetime generate --lang typescript --out-dir src/module_bindings --module-path spacetimedb
```

Client URI for Maincloud: `https://maincloud.spacetimedb.com` (local dev: `ws://localhost:3000`). Web reads `VITE_SPACETIMEDB_HOST` / `VITE_SPACETIMEDB_DB_NAME`; bridge reads `SPACETIMEDB_HOST` / `SPACETIMEDB_DB_NAME`.

Claude Code setup for Spacetime (each teammate, once):
```bash
claude plugin marketplace add clockworklabs/SpacetimeDB
claude plugin install spacetimedb@spacetimedb-plugins --scope user
```
Or paste into Claude Code: "Read https://spacetimedb.com/agent-setup.md and set yourself up."

---

## 6. Web app (`src/`) — responder board, desktop only

Two routes, no auth beyond a name prompt stored in localStorage.

**`/board`** (projector + responder laptops)
- `useTable(tables.request)` → sort by `score` desc, then `createdAt`.
- Row: tier chip · score · raw text with **highlighted quoted words** (from `facts.quotes`) · reasons as small chips · state badge · timer ("unclaimed 00:14") · Claim / Release / Resolve buttons.
- Red row style for `state === 'flagged'`. Pulse animation on insert.
- Top bar: counts (open / critical / flagged / claimed), "Inject 2,000", "Reset demo".
- Right drawer on row click: full facts JSON, check-in history (`outbox` + `call` rows for this request).

**`/victim-sim`** (dev only, hidden) — a text box that calls `submitRequest` and `victimReplied` directly so the board can be built before Photon works. Keep it; it's the fallback if the venue network kills Photon.

Hooks: `SpacetimeDBProvider` in `main.tsx` (template already does this), `useTable`, `useReducer(reducers.claimRequest)`. Claim errors surface as a toast ("Taken by Alex").

Style: dark, big type, readable from 15 ft. No design system work beyond that.

---

## 7. Bridge (`bridge/`) — Node 24, TypeScript, one process

Responsibilities, in one loop each:

1. **Photon inbound → Spacetime.** Subscribe to Photon events (Socket.IO: `io("https://api.photon.codes", { path: "/v1/projects/${PHOTON_PROJECT_ID}/events/ws", addTrailingSlash:false, transports:["websocket"], extraHeaders:{ Authorization: "Bearer "+PHOTON_API_KEY } })`, on connect emit `subscribe {startSeq: cursor}`, listen `delivery(event, {seq})`). Handle `message.received`: `event.data.object` is the message; use `object.sentBy.handle` (victim), `object.space.id`, `object.receivedBy.id` (our agent user id → `senderId` when replying), `object.content.text`. If victim has an open request → `victimReplied`, else → `submitRequest`.
   Fallback if the socket is flaky: poll `GET /v1/projects/{id}/messages?direction=received&order=asc&createdSince=...` every 2 s (this is what Photon's own quickstart does).
2. **Outbox drain.** Spacetime `onInsert` on `outbox` (and a 2 s sweep for `queued`): `takeOutbox` → do the thing → `completeOutbox`.
   - `extract_facts` → Claude → `setFacts`.
   - `send_text` → `POST https://api.photon.codes/v1/projects/{id}/messages` body `{ spaceId, senderId, content: { type:"text", format:"plain", text } }`, header `idempotency-key: outbox-${id}`. 202 = accepted, not delivered.
   - `place_call` → ElevenLabs outbound (§9) → `completeOutbox(ok, conversation_id)`.
3. **Call results.** Poll `GET https://api.elevenlabs.io/v1/convai/conversations/{conversation_id}` every 3 s until `status` is `done`/`failed`; read `metadata.phone_call.call_result` (`answered | voicemail | busy | no_answer | failed`) and the transcript for "1"/"2"/"yes"/"no" → `callResult`. Also handle Photon `VoiceCallDtmfReceived` / `VoiceCallEnded` events on the same socket if they arrive (verify at the Photon table; webhooks need a public URL via ngrok, the socket does not).

Claude extraction (`claude-sonnet-5-5`, or `claude-haiku-5-5` if latency matters), temperature 0, JSON only:

```
System: You extract facts from an emergency help request. Return ONLY JSON:
{ "age": number|null, "people": number|null, "medical": ["oxygen","dialysis","insulin","ventilator","mobility","pregnant"...],
  "hazards": ["no_power","no_water","flooding","trapped","fire","injury"...], "children": bool, "location": string|null,
  "quotes": [ exact substrings of the message that justify each item ] }
Never invent. If unsure, omit. quotes must be verbatim substrings.
```

The module's `setFacts` runs the rules; the bridge never scores anything.

Env (`bridge/.env`, never committed):
```
SPACETIMEDB_HOST=https://maincloud.spacetimedb.com
SPACETIMEDB_DB_NAME=nobody-missed
PHOTON_PROJECT_ID=pho_prj_...
PHOTON_API_KEY=pho_sk_...
ANTHROPIC_API_KEY=...
ELEVENLABS_API_KEY=...
ELEVENLABS_AGENT_ID=...
ELEVENLABS_PHONE_NUMBER_ID=...     # from GET /v1/convai/phone-numbers (provider=sip_trunk)
DEMO=true
```

---

## 7b. Limits check (researched 2026-11-07) — READ THIS FIRST

| Thing | Limit | What we do |
|---|---|---|
| Photon iMessage texts | **No per-message fee, no stated cap.** 25 shared assignments per project on Free. Victim must text first. | **Primary channel. Victim phone = an iPhone.** |
| Photon WhatsApp (personal) | **Not released** ("in internal testing", per Photon docs). | Don't use. |
| Photon WhatsApp Business | Needs a Photon SMS number + Meta signup flow. Time unknown. | Skip unless the Photon table says it's quick. |
| Photon SMS | US sending needs an approved 10DLC campaign (days). | Skip. |
| Photon US number (needed for voice) | $2/month. Voice $0.013/min. | Buy 1 number. Cents for the whole weekend. |
| Photon outbound call caller ID | Works without a business profile but "may be flagged" as spam. | Save the number as a contact on the victim phone named "Help Line". |
| ElevenLabs Free | **15 call minutes/month**, 4 concurrent calls. | ~45 test calls at 20 s each. **Start on Free.** Only one person tests calls. If >10 min used before demo: Twilio trial (free, 75 min) or Starter ($1 first month, 75 min). |
| ElevenLabs keypad (DTMF) | Supported on SIP trunk calls (out-of-band only). Digits arrive as a user turn in the transcript. | Agent asks "press 1 or say yes". We read the transcript. |
| ElevenLabs hang-up | `end_call` system tool, on by default for dashboard agents. | Keeps calls short = fewer minutes. |
| Twilio trial (backup only) | Calls only verified numbers, 30-day trial, 75 voice minutes. | Fine as backup: verify the victim phone. |

**Android (Dominic):** iMessage won't reach you and personal WhatsApp isn't released. Use your Android as the **responder laptop's second screen** or for the claim race. An iPhone teammate plays the victim.

**Smoothest flow, final:**
1. iPhone texts its assigned Photon iMessage number → bridge → `submitRequest`.
2. Check-in text goes back on the same iMessage thread.
3. No reply → bridge asks ElevenLabs to call the iPhone through the Photon number (SIP).
4. Agent says the check-in, listens for 1/2 or yes/no, hangs up.
5. Bridge reads `call_result` + transcript → `callResult` → board updates (claimed / reset / red).

---

## 8. Photon — exactly how it works on Beta (verified in docs + OpenAPI, 2026-11-07)

**Facts that shape the design:**
- Beta channels: iMessage, WhatsApp Business, Apple Messages for Business, Telegram, Email, Voice. Dashboard also lists SMS, WhatsApp (personal), Slack, Discord.
- **Shared iMessage line = per-user assignment.** `POST /v1/projects/{id}/platforms/imessage/assignments {handle:"+1214..."}` → Photon allocates a pooled number (`assignedPhoneNumber`) for that person. Free plan: 25 iMessage + 25 WhatsApp assignments. The agent can only send to a peer "who has messaged it since that Assignment" → **victim must text first** (matches our flow exactly).
- **There is no public "one number for everyone" on Free.** Dedicated iMessage lines are Business-only ($250/mo). For the demo: each teammate's phone gets an assignment. In the pitch say: "production uses a dedicated line / registered SMS number."
- **SMS:** US SMS sending requires an approved 10DLC campaign (compliance + carrier review, days). Not viable this weekend for outbound. Don't promise SMS to judges; say "SMS-ready once the campaign is approved."
- **Android:** personal WhatsApp is **not released** on Photon. An iPhone teammate plays the victim (see §7b).
- **Sending:** `POST /v1/projects/{id}/messages` with `spaceId`, `senderId`, `content {type:"text", format:"plain", text}`. SDK: `npm install @photon-ai/api@0.5.0` (Node ≥ 24), `new Photon({ headers: { Authorization: "Bearer "+key } })`, `photon.projects.sendMessage(...)`, `photon.projects.listMessages(...)`.
- **Receiving:** Socket.IO event stream (no public URL needed) or polling `listMessages`. Webhooks exist (`whsec_` signing, Standard Webhooks lib) but need ngrok.
- **Voice:** Photon has **no "create call" REST endpoint**. Calls are SIP: Photon's number is imported into ElevenLabs as a SIP trunk; ElevenLabs places the call through Photon (`sip.photon.codes:5061`, TLS). Photon emits `VoiceCallRinging/Answered/DtmfReceived/Ended` events. Voice needs an **eligible number**: a purchased SMS number (`POST /v1/projects/{id}/platforms/sms/numbers {countryCode:"US", areaCode:"214"}`, async operation) or a dedicated line. **Shared lines cannot take calls.** Voice is $0.013/min US; Free includes none — your $100 credit should cover it, confirm at the Photon table.

**Photon API key:** project sidebar → API keys → New API key → permissions `project:read`, `project:write`, `platforms:write`. Shown once.

---

## 9. Calling — the selling feature. Build it FIRST, in parallel.

**Primary: ElevenLabs agent over Photon SIP (documented by Photon).**

Manual setup (Dominic, ~45 min):
1. Photon: buy one US SMS number (dashboard → SMS → purchase, or the API above). Wait for the operation; numbers need a ~15 min activation wait.
2. Photon → Voice → Lines → that number → create default SIP profile → **Outbound calls** → SHA-256 → Enable outbound → save the one-time password + username. Note `sip.photon.codes:5061`.
3. ElevenLabs (free account, choose **ElevenAgents** at signup): Agents → create agent "Welfare Check". First message: "This is an automated check-in from the disaster help line. If you still need help, press 1 or say yes. If you are okay, press 2 or say no." (nothing after "say no."). System prompt: "You make a 20-second welfare check call for a disaster help line. Say the first message once. Listen for 1, 2, yes or no. If the person says yes or presses 1, say 'Thank you, we are keeping your request open.' If no or 2, say 'Glad you are okay, we are closing your request.' If you hear nothing after one repeat, say 'We will send someone to check on you.' Then end the call. Never ask other questions. Never give medical advice." Voice mode **Custom**. Left sidebar → **Tools** → turn on system tools **End conversation** and **Voicemail detection**. Publish. (Already done by Dominic: agent "Welfare Check" published.)
4. ElevenLabs → Phone Numbers → Import → From SIP Trunk → the Photon number (E.164). Outbound: address `sip.photon.codes:5061`, TLS, media encryption Allowed, codecs G.722/PCMU/PCMA, username/password from step 2. Assign the agent.
5. Photon → Voice profile → Inbound: destination `sips:sip.rtc.elevenlabs.io:5061`, TLS (so the same number also answers calls — nice extra).
6. `GET https://api.elevenlabs.io/v1/convai/phone-numbers` (header `xi-api-key`) → copy `phone_number_id` → env.
7. Test from the ElevenLabs UI: number → Outbound call → your phone. It must ring before anyone writes code against it.

Bridge places the call:
```ts
POST https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call
headers: { "xi-api-key": KEY, "Content-Type": "application/json" }
body: { agent_id, agent_phone_number_id, to_number: "+1214...",
        conversation_initiation_client_data: { dynamic_variables: { case_id: "7", first_name: "..." } },
        telephony_call_config: { ringing_timeout_secs: 20 } }
→ { success, message, conversation_id, sip_call_id }
```
Result: poll `GET /v1/convai/conversations/{conversation_id}` → `metadata.phone_call.call_result` ∈ answered / voicemail / busy / no_answer / failed; transcript turns for 1/2. voicemail counts as no_answer.

**Unknowns to confirm at the ElevenLabs/Photon tables (first 30 min):** free-tier SIP outbound allowed? DTMF captured by the agent or only by Photon events? If ElevenLabs blocks outbound on free, use the backup.

**Backup A: Twilio REST through Photon SIP** (Photon cookbook "voice/twilio", step 8). Twilio `POST /Calls` with `To=sip:+1214...@sip.photon.codes;transport=tls;secure=true`, `From=<Photon number>`, SIP credentials from the Photon outbound profile, `Twiml=<Response><Say>…</Say><Gather numDigits="1"/></Response>`. Status via `GET /Calls/{sid}` (`completed`, `no-answer`, `busy`). Still "through Photon". Trial Twilio only calls verified numbers.

**Backup B: plain Twilio** (no Photon in the call). Works in 30 min. Say so honestly in the pitch.

**Stage rules:** laptop running the bridge on a phone hotspot, not venue Wi-Fi. Victim phone ringer max, DND off. If the phone has not rung within 10 s, the on-screen state still turns red and the presenter says "in production this rings". Record one good take as a backup video.

---

## 10. Repo layout (GitHub, public — Spacetime requires it to win)

```
nobody-missed/
├── README.md                  # pitch, flow, demo script, setup
├── SPEC.md                    # this file
├── .env.example
├── spacetimedb/               # Spacetime module (created by `spacetime dev --template react-ts`)
│   └── src/index.ts
├── src/                       # React board (template puts it at root; keep it)
│   ├── main.tsx  App.tsx  board/  module_bindings/ (generated, committed)
├── bridge/
│   ├── package.json  src/index.ts  src/photon.ts  src/claude.ts  src/calls.ts  src/rules.test.ts
├── scripts/inject.ts          # calls injectLoad(2000)
└── docs/slides-rules.md       # the 6 rules, one slide
```

Branching: `main` (no force push), one branch per person (`board`, `module`, `bridge`, `calls`), merge small PRs often. Commit `module_bindings/` so the board builds without the CLI.

---

## 11. Team split (4 people, or merge C+D for 3)

| Who | Hours 0–6 | Done when |
|---|---|---|
| **A — Calls** (highest risk) | §9 setup, then `bridge/src/calls.ts`: `placeCall(to, caseId)` + `waitForResult()` | A phone rings from a script and `call_result` prints. Then wires `place_call` outbox kind. |
| **B — Spacetime module** | §4–5 tables, rules, `tick`, all reducers, `injectLoad`. Unit-test rules. Publish to Maincloud. | Two browser tabs race `claimRequest`, one loses. `tick` moves a row new→waiting→checkin_text_sent on the demo clock. |
| **C — Board** | §6 on the react-ts template; uses `/victim-sim` until Photon is live | Projector-ready board with claim race, red flagged rows, inject button. |
| **D — Photon + Claude bridge** | §7–8: assignments for every teammate's phone, inbound socket → reducers, outbox `send_text`, Claude extraction | Texting the line creates a ranked row; a check-in text arrives on the phone; replying "1" resets it. |

**Hours 6–9:** integrate: real text → rank → check-in → call → red. Everyone on one laptop.
**Hour 9–10:** `injectLoad(2000)` on Maincloud; confirm board stays smooth (virtualize the list if needed; show top 200 + counts).
**Last 2–3 h:** rehearse ×3 in the venue, record backup video, README, Devpost, 1-slide rules.

**Cut order if behind:** ElevenLabs → Twilio backup → drop the call (text + red only) → drop inject → drop escalation climb. **Never cut the check-in text and the red flag.**

---

## 12. Manual setup — Dominic does these before the Claude Code session starts

1. **GitHub:** create public repo `nobody-missed`, add all teammates as collaborators, clone. Add `.env`, `.spacetimedb-token`, `node_modules`, `dist` to `.gitignore`.
2. **Spacetime:** install CLI; `spacetime login`; redeem code `HACKUTD2026` at spacetimedb.com/redeem (each teammate, own GitHub); run `claude plugin marketplace add clockworklabs/SpacetimeDB` + `claude plugin install spacetimedb@spacetimedb-plugins --scope user`.
3. **Photon (you're signed in):** New project "nobody-missed" → API key (`project:read`, `project:write`, `platforms:write`) → put in `bridge/.env`. Create one iMessage shared-line assignment per iPhone on the team; write down each `assignedPhoneNumber` — that's the number each person texts.
3b. **ElevenLabs:** stay on Free (15 call minutes). Only Person A tests calls, and keeps them under 20 s. Fallback: Twilio trial (free) or Starter ($1 first month).
4. **Photon voice:** buy one US SMS number (area code 214/972), create voice profile, enable outbound, save credentials (§9 steps 1–2).
5. **ElevenLabs:** free account → API key → agent → import Photon number as SIP trunk (§9 steps 3–6).
6. **Anthropic:** API key in `bridge/.env`.
7. **Ask at sponsor tables (write answers in README):** Photon: does $100 credit cover voice minutes + the SMS number? Do voice call/DTMF events arrive on the Socket.IO stream? Does WhatsApp personal assignment work for Android? ElevenLabs: is SIP outbound allowed on the free tier?
8. **Hotspot** for the demo laptop. Confirm one iPhone on the team.

### MCP servers for the build sessions (each teammate adds the ones they need)

| MCP | Who | Add with | Notes |
|---|---|---|---|
| **Spacetime** | B, C (module + board) | Installed by the plugin in step 2 (`spacetime mcp`). | Safe tool: `ping`. `call` and `sql` can change data, approve them manually. |
| **Photon** | D (bridge), A (calls) | `claude mcp add --transport http photon https://mcp.photon.codes/mcp`, then `/mcp` → **photon** → sign in (OAuth). | Manages project, lines, messages, billing. Dashboard-only: plans, payment, SSO. Docs: `/docs/beta/ai-tools/mcp`. |
| **ElevenLabs** (optional) | A (calls) | `claude mcp add --transport http elevenlabs https://api.elevenlabs.io/v1/mcp`, then `/mcp` → **elevenlabs** → sign in (OAuth). | Tool list unverified. Don't depend on it for agent edits or placing calls; the dashboard and the REST calls in §9 are the source of truth. |

The Photon-to-ElevenLabs SIP connection (outbound credentials, importing the number) is dashboard-only on both sides. Do it by hand (§9).

Nothing else needed.

---

## 13. Ethics answer (judges will ask)

"Triage already happens — 911 and START tags rank people. The failure today is a request nobody reads. We never let AI decide: it extracts the person's own words, a readable rule ranks, a human claims. Nothing is hidden, waiting raises priority but is capped so silence can never outrank a confirmed emergency, and every rank, claim and override is logged."

---

## 14. Kickoff prompt for the Claude Code session (paste as-is)

```
Read SPEC.md fully before touching anything. We are building "Nobody Missed" for HackUTD 2026.
Constraints: Spacetime (SpacetimeDB 2.x, TypeScript module) is the ONLY backend and database — no Express, no other DB.
Photon is the messaging/voice layer, ElevenLabs places calls over Photon SIP, Claude only extracts facts.
First: run the Spacetime agent setup (https://spacetimedb.com/agent-setup.md) if not already done, then
`spacetime dev --template react-ts` in this repo to scaffold. Then implement §4–§5 (module) exactly as specified,
with unit tests for the scoring rules, and get two tabs racing `claimRequest`. Keep DEMO=true timers (÷60).
Do not add features outside SPEC.md. Ask before changing the state machine or the rules.
```
