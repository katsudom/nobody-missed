You are setting up and building "Nobody Missed" for HackUTD 2026.

Repo: https://github.com/katsudom/nobody-missed (public, owner katsudom, currently empty). Work in a local clone of it. If this folder is not that clone, clone it and move there first.

Step 0, before anything else: copy the spec into the repo.
- Source file: C:\Users\Dominic Pham\AppData\Roaming\Claude\scratch-workspaces\409bc0e7-949f-47f7-b253-4aaebd1f1c79\b4e76476-5930-4746-be44-8f0249c8a7e4\scratch-2026-11-07-17c155\NOBODY-MISSED-SPEC.md
- Copy it to `SPEC.md` at the repo root. Also copy this prompt file (HANDOFF-PROMPT.md, same folder) to `docs/HANDOFF-PROMPT.md`.
- Create `.gitignore` with at least: node_modules, dist, .env, .env.*, !.env.example, .spacetimedb-token.
- Commit "Add spec and handoff" and push to main. If git asks for GitHub sign-in, tell me to run the sign-in myself.

SPEC.md is the source of truth. Read all of it before doing anything else.

Current status (done by Dominic by hand):
- Photon project created. Project ID: pho_prj_01m6w0pqv3eh7sd108ed59b3c8. A Full-access API key exists (Dominic has it).
- A Photon US number was bought and is activating (needed for voice only).
- ElevenLabs agent "Welfare Check" is published with End conversation + Voicemail detection on.
- iMessage shared line not tested yet. SIP connection between Photon and ElevenLabs not done yet (SPEC §9 steps 2, 4, 5, 6).

Hard rules:
- Spacetime (SpacetimeDB 2.x, TypeScript module) is the ONLY backend and database. No Express, no other DB. The bridge is a thin Node process that only moves events in and drains the outbox (SPEC §3, §7).
- Never ask me to paste a secret into chat. When you need a key, create or update `bridge/.env` with an empty variable, tell me the exact variable name and where to get the value, and wait until I say it's filled in. Never commit `.env` or `.spacetimedb-token`; make sure `.gitignore` covers them before the first commit.
- Use the demo timers (DEMO=true, real ÷ 60). Don't add features outside SPEC.md. Ask before changing the state machine, the scoring rules, or the flow.
- Commit in small steps with clear messages and push to main. Tell me after each push what now works.

Do this in order, and stop at each checkpoint to show me what works:

1. Tooling. Check `spacetime --version`. If missing, install it (Windows PowerShell: `iwr https://windows.spacetimedb.com -useb | iex`). Run the agent setup from https://spacetimedb.com/agent-setup.md for Claude Code. If `spacetime login` is needed, tell me to run it myself.
2. Scaffold. Run `spacetime dev --template react-ts` in the repo so `spacetimedb/` and `src/` exist. Add `bridge/` (Node 24, TypeScript), `scripts/`, `.env.example` (variable names only, from SPEC §7), and a short README with the pitch, the 7-step flow and setup steps. Commit and push. CHECKPOINT: teammates can clone and run it.
3. Spacetime module (SPEC §4–5): tables, scoring rules with unit tests, state machine, the 1-second `tick` scheduled reducer, every reducer in the table, `injectLoad`, `resetDemo`. CHECKPOINT: two browser tabs race `claimRequest` and only one wins; a test request moves new → waiting → checkin_text_sent on the demo clock.
4. Responder board (SPEC §6), including `/victim-sim` so everything works before Photon. CHECKPOINT: board shows ranked rows with highlighted words, red flagged rows, claim race, Inject 2,000.
5. Bridge, Claude part (SPEC §7). Ask me for `ANTHROPIC_API_KEY`. CHECKPOINT: a message typed in `/victim-sim` gets facts and a rank.
6. Bridge, Photon part (SPEC §7–8). Ask me for `PHOTON_API_KEY` (PHOTON_PROJECT_ID is above). Walk me through adding my teammate's iPhone as an iMessage assignment if it isn't done. CHECKPOINT: a real iMessage creates a ranked row and the check-in text arrives on the phone; replying 1 or 2 works.
7. Calls (SPEC §9). Walk me through the SIP steps I still need to do by hand, then ask me for `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` and `ELEVENLABS_PHONE_NUMBER_ID`. Use as few test calls as possible: the ElevenLabs free plan is only 15 call minutes. CHECKPOINT: an ignored check-in text makes the iPhone ring, and no answer turns the row red.
8. Publish the module to Maincloud and point the board and bridge at it. CHECKPOINT: full demo script (SPEC §2) runs end to end.

If something in SPEC.md turns out to be wrong when you try it (an API differs, a plan blocks a feature), stop, tell me what you found and what you propose, and use the backups in SPEC §9.
