# Status (2026-11-07)

## Goal
Steps 1–8 of docs/HANDOFF-PROMPT.md. Now: Step 6 (Photon iMessage), last mile.

## Done
- 1 tooling, 2 scaffold, 3 module (published to Maincloud `nobody-missed`), 4 board (Dorothy's PRs #1 + #13, live on Vercel), 5 Claude bridge (verified live).
- Inject/Reset admin-only (admin table; Dominic's browser id c200a322… added). Injury +30 / pregnancy +20 rules approved and live.
- Step 6 code: bridge/src/photon.ts (polls received iMessages every 2s, sends check-in texts) wired into bridge/src/index.ts. PHOTON_API_KEY is in bridge/.env and polling runs with no errors (list call authorized).

## Next (Step 6 checkpoint)
1. Walk Dominic through adding the teammate's iPhone as an iMessage shared-line assignment (Photon dashboard -> project -> iMessage -> enter the phone's iMessage number -> Add -> assign from shared pool -> note the assigned number). Victim must text first.
2. Teammate texts the assigned number -> expect "new request" in the bridge log, a ranked row on the board.
3. Wait for the check-in text on the phone (critical: ~5s after facts; normal: ~20s). Reply 1 (keeps open) / 2 (closes). Check the board.
4. Untested: sendText against the real API (202 + id), victimReplied via real reply, sentBy/receivedBy field shapes on a real message.
Then Step 7 (ElevenLabs calls via Photon SIP; 15 free minutes, few test calls), Step 8 (full demo script SPEC §2).

## Running
- Bridge in Dominic's terminal tab c5 (`cd bridge; npm start`). Must stay open. No subagents.

## Team
- Dorothy: case list; Kevin: top bar/name prompt/side panel; Will: victim-sim page + pitch. Teammates PR, Dominic merges (squash).
