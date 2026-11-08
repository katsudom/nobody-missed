# Project context — Nobody Missed (HackUTD 2026)

Source of truth: `SPEC.md`. Build order and checkpoints: `docs/HANDOFF-PROMPT.md`.

## Vault
- Vault at `vault/` (start at `vault/Home.md`). The repo is public: no phone numbers, keys or personal details in it.
- Mapping: `Status` stays at `.claude/orchestrate/status.md` (under 60 lines); no `Areas/`, `Scopes/` or `Runs/` yet.

## Source control
- Base branch: `main`. A push to `main` deploys the board to Vercel (nobody-missed.vercel.app) in ~1 min.
- Teammates (Dorothy, Kevin, Will) work on their own branches and open PRs; Dominic approves merges. Squash-merge.
- Module changes do NOT deploy on push: they need `spacetime publish nobody-missed --module-path spacetimedb --server maincloud -y`, run in Dominic's real terminal (run_in_terminal), because his login lives there.
- `sync.py --base origin/main --branches 'origin/*'`

## The right way to ask
- Online data -> `spacetime sql --server maincloud --anonymous nobody-missed "SELECT ..."` (sandbox CLI; no GROUP BY)
- Call a reducer as a stranger -> `spacetime call --server maincloud --anonymous nobody-missed <snake_name> <json args>`
- Owner-only reducers (make_admin, reset_demo) -> Dominic's terminal: `spacetime call --no-config --server maincloud nobody-missed ...`
- Rule tests -> `cd spacetimedb && npm test`; module typecheck -> `cd spacetimedb && npx tsc --noEmit -p .`
- Bridge typecheck -> `cd bridge && npx tsc --noEmit`; board build -> `npm run build`
- Photon API shapes -> `api.photon.codes/openapi.json` (4 MB; query with node, never read whole)

## Rules to copy into every writing agent's brief
- Spacetime is the only backend/database. Bridge is thin: moves events, drains outbox, decides nothing.
- Ask Dominic before changing the state machine, scoring rules, or flow. No features outside SPEC.md.
- Never put secrets in chat, code, or commits. Keys live only in `bridge/.env` (gitignored). A pre-commit hook blocks keys.
- After a module change: regenerate `src/module_bindings` (`spacetime generate --lang typescript --out-dir src/module_bindings --module-path spacetimedb -y`) and commit them.
- Commits go under katsudom only: NO Co-Authored-By trailer, no "Generated with Claude Code" line (Dominic, 2026-11-07).

## Only the orchestrator, and only when the owner says so
- Maincloud publish, reset_demo, make_admin, merging teammate PRs, anything that sends a real text or places a real call.

## Time and environment facts
- My shell is a sandbox with its own AppData: Dominic's `spacetime` login is NOT visible there. Documents is shared.
- The bridge runs in Dominic's terminal tab (`cd bridge; npm start`); it must stay open.
- ElevenLabs free plan = 15 call minutes total: minimize test calls.

## Follow-on steps agents skip
- Regenerate + commit bindings after module changes; republish module; update SPEC when the owner approves a rule change.

## How the owner wants to hear about it
- ADHD mode: lead with the next action, numbered steps, plain words (no jargon), short. State where we are in the 8 steps.
