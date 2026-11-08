# Status (2026-11-07)

## Goal
Steps 1–8 of docs/HANDOFF-PROMPT.md. Now: Step 6 (Photon iMessage).

## Done
- 1 tooling, 2 scaffold, 3 module (published to Maincloud `nobody-missed`), 4 board (Dorothy's PR #1 + #13, Vercel), 5 Claude bridge (running, verified).
- Inject/Reset admin-only (admin table; Dominic's browser id added). Injury +30 / pregnancy +20 rules approved and live.

## In progress — Step 6
- `bridge/src/photon.ts` written (poll received iMessages every 2s, sendText). Not wired into index.ts, not typechecked.
- Needs from Dominic: PHOTON_API_KEY in bridge/.env; teammate iPhone added as iMessage assignment in Photon dashboard.

## Next
- Wire photon.ts: inbound -> submitRequest / victimReplied; outbox send_text (imessage via Photon, sim = mark done).
- Test with a real iMessage. Then Step 7 (calls, ElevenLabs), Step 8 (full demo).

## Running
- Bridge in Dominic's terminal tab c4. No subagents.
