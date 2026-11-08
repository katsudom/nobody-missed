# Status (2026-11-07)

## Goal
Steps 1-8 of docs/HANDOFF-PROMPT.md. Steps 1-7 DONE (calls verified 2026-11-07). Next: Step 8 demo (docs/demo-plan.md), after Dominic's go.

## Done
- 1 tooling, 2 scaffold, 3 module (published to Maincloud `nobody-missed`), 4 board (Dorothy's PRs #1 + #13, live on Vercel), 5 Claude bridge (verified live).
- Inject/Reset admin-only (admin table; Dominic's browser id c200a322... added). Injury +30 / pregnancy +20 rules approved and live.
- Step 6 verified live 2026-11-07 with a real iPhone: text -> request 41411 (oxygen + no_power, score 81) -> check-in text arrived -> reply 1 reset to waiting -> second check-in -> flagged (no call yet) -> reply 2 closed it, place_call cancelled.
- Photon: 1 of 25 iMessage assignments used (teammate's iPhone; numbers are in the Photon dashboard, never in this public repo).
- photon.ts: receivedBy is optional in Photon's schema; falls back to addressedTo / other space participant; logs skipped messages.

- Approved + live: after a "1" reply the next check-in waits T1_AFTER_REPLY (10 demo-s / 10 real min), not the 5 s critical T1. rules.ts, published.

- Storm check-ins (Dorothy's PR #16) merged b2f8463 + published (data kept). Her site is live: no map, Check-In Command Center home, #/reports board. #15 layout and the Real/Fake switch were dropped (her files won). Bridge restarted on new bindings.

- Storm flow verified live 2026-11-07: fixed area Richardson, team phone joined via JOIN, Start storm -> alert arrived (re-text after 15 s), reply 1 -> checkin 212 safe. Teammate role (storms/seed/inject) vs admin (resets) live. Reply 2 on a storm not yet tried on a real phone.

## Planned, NOT built
- 2-minute demo timeline + demo timers (25/20/20 s) + Skip ahead button: docs/demo-plan.md. Build after Step 7. (Dominic: plan only, don't code yet)
- Call only after 2 unanswered check-in texts (the first one counts): the STORM ladder already does this (text -> re-text -> call). Still open for the old victim-texts-first request flow only.

## Open questions for Dominic
- Reply 2 sends no confirmation text (SPEC has none). Fine or add one? (flow change, ask first)

## Next
- Second demo phone: add as Photon iMessage assignment, then text JOIN. Teammates send Dev ids; Dominic adds them in Dev tools.
- Bridge: storm place_call carries checkinId -> report with checkinCallResult (Step 7).
- Step 7: ElevenLabs outbound call via Photon SIP (needs a purchased Photon SMS/voice number; 15 free call minutes, few test calls). Then Step 8 (demo script SPEC sec 2).

## Running
- Step 7 verified: Photon voice number -> ElevenLabs SIP trunk, agent 'Welfare Check' (first message typed in the agent, storm script). Storm silent -> call rang; pressed 1 -> safe, pressed 2 -> needs help + report. Calls switch: table setting key 'calls', admin-only setCalls, off by default, End storm turns it off. Wording: 'automated emergency check-in' (no State Farm).
- Known: agent is very interruptible (crowd noise); Dominic to turn off 'Interruptible' in ElevenLabs. After storm 'needs help' the report also runs the old request chase (text + call) quickly; ask Dominic if that's wanted.
- Bridge: run `cd bridge; .un.ps1` (auto-restarts on crash) in the watching session's own tab so it can read the log. Only ONE bridge at a time (two pollers would double-submit). After any module publish that changes tables, restart it (old bindings crash).

## Team
- Dorothy (GitHub wonillionaire): storm check-ins + current site; bakudan01 made #15 (dropped); Kevin: top bar/name prompt/side panel; Will: victim-sim page + pitch. Teammates PR, Dominic merges (squash).
