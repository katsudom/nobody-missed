# Status (2026-11-07)

## Goal
Steps 1-8 of docs/HANDOFF-PROMPT.md. Step 6 DONE. Next: Step 7 (ElevenLabs calls), only after Dominic says go.

## Done
- 1 tooling, 2 scaffold, 3 module (published to Maincloud `nobody-missed`), 4 board (Dorothy's PRs #1 + #13, live on Vercel), 5 Claude bridge (verified live).
- Inject/Reset admin-only (admin table; Dominic's browser id c200a322... added). Injury +30 / pregnancy +20 rules approved and live.
- Step 6 verified live 2026-11-07 with a real iPhone: text -> request 41411 (oxygen + no_power, score 81) -> check-in text arrived -> reply 1 reset to waiting -> second check-in -> flagged (no call yet) -> reply 2 closed it, place_call cancelled.
- Photon: 1 of 25 iMessage assignments used (teammate's iPhone; numbers are in the Photon dashboard, never in this public repo).
- photon.ts: receivedBy is optional in Photon's schema; falls back to addressedTo / other space participant; logs skipped messages.

- Approved + live: after a "1" reply the next check-in waits T1_AFTER_REPLY (10 demo-s / 10 real min), not the 5 s critical T1. rules.ts, published.

- Storm check-ins (Dorothy's PR #16) merged b2f8463 + published (data kept). Her site is live: no map, Check-In Command Center home, #/reports board. #15 layout and the Real/Fake switch were dropped (her files won). Bridge restarted on new bindings.

## Planned, NOT built (Dominic: plan only, don't code yet)
- Call only after 2 unanswered check-in texts (the first one counts). Today: 1 unanswered text -> call. Will use request.checkinsSent. Needs SPEC §1/§4 update when built.

## Open questions for Dominic
- Reply 2 sends no confirmation text (SPEC has none). Fine or add one? (flow change, ask first)

## Next
- Real-phone storm test: teammate texts JOIN -> Dev panel Seed 1,000 -> Start storm -> storm text arrives -> reply 1 (safe) / 2 (needs help, report opens). Not yet run.
- Bridge: storm place_call carries checkinId -> report with checkinCallResult (Step 7).
- Step 7: ElevenLabs outbound call via Photon SIP (needs a purchased Photon SMS/voice number; 15 free call minutes, few test calls). Then Step 8 (demo script SPEC sec 2).

## Running
- Bridge in a terminal tab started by the Step 6 session (`cd bridge; npm start`). Must stay open. Only ONE bridge at a time (two pollers would double-submit).

## Team
- Dorothy: case list; Kevin: top bar/name prompt/side panel; Will: victim-sim page + pitch. Teammates PR, Dominic merges (squash).
