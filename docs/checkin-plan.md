# Proposal: storm check-ins (we reach out, not wait for reports)

Status: **built on branch `wonillionaire-checkin`, tested on a local database, not published.** Dominic approved the backend change and dropping the map.

## Why

The pitch is "we chase the people who stop answering", but the board today only shows people who already texted us. This flips it: when a storm hits, we text **every household in the impact zone**, mark who checks in, and chase the silent ones until a human is sent.

## The flow

1. **Households exist before the storm.** Fake policyholders live in 10 DFW cities. 1–3 team phones are real households. Everyone has already joined storm alerts by texting the line.
2. **Start storm** (admin button) hits 2–3 random cities (always including a team phone's city).
3. Every household inside gets a text: *"Storm alert from State Farm. Reply 1 if you're safe. Reply 2 if you need help."*
4. **Reply 1** → marked **Checked in (safe)**. Done.
5. **Reply 2** → marked **Needs help** and becomes a ranked report (the board we already have: score, claim, resolve). Their next message is the details.
6. **No reply** → re-text after T1, then **call** after T2 (press 1 safe / 2 help), then after T3 → **Urgent: no contact**, red, needs a welfare check.
7. A responder can claim any urgent or needs-help household. Claiming stops the chasing.

Demo timers are real ÷ 60 (same as now):

| Step | Real | Demo |
|---|---|---|
| T1: re-text if no reply | 15 min | 15 s |
| T2: call if still no reply | 10 min after re-text | 10 s |
| T3: urgent if call unanswered | right after no answer, or 10 min | 10 s |

## Constraint: Photon can't text first

On Photon Free, "the agent can only send to a peer who has messaged it" (SPEC §8), and US outbound SMS needs a 10DLC approval (days). So:

- **Real phones must enroll once** by texting the line before the demo (e.g. "join"). That is realistic: customers opt in to storm alerts.
- **Fake households are simulated**: no real texts. The server answers for them with seeded randomness, roughly 60% reply 1 within T1, 10% reply 2, 30% go silent (they walk the full text → call → urgent ladder).
- **Calls** go out through ElevenLabs/SIP and don't need an earlier message, so the call step works for real phones.
- Pitch line: "production uses a registered SMS number; Photon iMessage for the demo."

## Backend changes (`spacetimedb/`, Dominic)

New tables:

```ts
household {            // the people we watch over (fake + real team phones)
  id: u64 pk autoInc
  name: string          // fake policyholder name
  handle: string index  // phone for real ones, "sim-123" for fake
  platform: string      // "imessage" | "sim"
  spaceId: string       // Photon conversation, set when a real phone enrolls
  photonSenderId: string
  address: string, city: string index, age: u32, policy: string
  real: bool            // true = actually text/call it
}

storm {                 // one active storm at a time
  id: u64 pk autoInc
  cities: string        // affected cities, comma separated
  startedAt: timestamp
  active: bool
}

checkin {               // one per household inside the storm
  id: u64 pk autoInc
  stormId: u64 index
  householdId: u64 index
  state: string         // texted | retexted | called | safe | needs_help | urgent | claimed | closed | no_reply
  textsSent: u32, callsPlaced: u32
  claimedBy: option<identity>
  requestId: option<u64> // the report row, once they reply 2 or go urgent
  createdAt, updatedAt: timestamp
}
```

New or changed reducers:

| Reducer | Who | Does |
|---|---|---|
| `seedHouseholds(n)` | admin | Insert n fake households at random positions (`ctx.random`). |
| `enrollHousehold(name, handle, ...)` | bridge | When a real phone texts "join", create/update its household with its Photon space. |
| `startStorm()` | admin | Close any old storm, pick 2–3 cities, create a `checkin` for each household there, queue `send_text` for real ones. |
| `endStorm()` side effect | | Anyone who never answered becomes `no_reply` (still unaccounted for, not "handled"); queued texts/calls are cancelled. |
| `endStorm()` | admin | Mark storm inactive, stop chasing. |
| `victimReplied` (changed) | bridge | If the phone has an open check-in: "1" → `checked_in`, "2" → `needs_help` + create a `request`. Otherwise current behaviour. |
| `claimCheckin / resolveCheckin` | web | Same one-winner rule as `claimRequest`. |
| `tick` (extended) | scheduled | Walk open check-ins: T1 re-text, T2 call, T3 urgent. Fake households roll their simulated reply here. |

The existing `request` pipeline (facts, scoring, claim) stays for "needs help" reports, so nothing already built is thrown away.

Bridge: handle "join" → `enrollHousehold`. Outbox kinds stay `send_text` / `place_call`, and the call script changes to "press 1 safe, 2 help".

## Board changes (`src/`)

No map (team decision). Layout:

- **Top:** "Checked in 65%", the stacked bar Safe / Waiting / Needs help / Urgent, and "2,712 of 4,200 households replied" (this is what the mockup was showing).
- **By city:** one bar per affected city with % safe and urgent / needs-help counts.
- **Queue tabs:** Urgent (no contact) · Needs help · Waiting (shows "re-text in 0:08", "calling…") · Safe.
- **Row:** name, address, attempts ("2 texts, 1 call"), time since storm, Claim.
- **Detail panel:** timeline of every text/call/reply for that household.
- **Admin dev panel:** Seed households, Start storm, End storm (plus existing Reset).
- **`/victim-sim`:** pick a household → buttons "Reply 1", "Reply 2", "Ignore".

## Demo script (2 min, replaces SPEC §2)

1. ~2,000 households on file. Press **Start storm**: 2–3 cities are hit and ~500 households get the alert.
2. Within seconds most turn green (checked in). The teammate's real phone buzzes with the alert.
3. Teammate replies **2** → moves to Needs help, ranked, words highlighted.
4. A second teammate's phone ignores the text → re-text → phone rings on stage → ignored → row turns red **Urgent: no contact**.
5. A responder claims it. "Everyone else ranks reports. We chase the people who stop answering."

## Open questions for the team

1. OK to change the SPEC §1 flow from "victim texts first" to "we text the zone first"?
2. Dominic: time to add the tables/reducers before the demo? Rough size: ~200 lines in `spacetimedb/`, small bridge change.
3. Keep the current "text us for help" path too? (Recommended: yes, it still works for people not enrolled.)
4. How many real phones can we enroll (each teammate's iPhone texts the line once)?
