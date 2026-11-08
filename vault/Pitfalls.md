---
title: Pitfalls
area: index
sources: [.claude/orchestrate/lessons.md, spacetimedb/src/rules.test.ts, SPEC.md, README.md, docs/demo-script.md]
verified: ffb6eda
---
Summary: What's wrong right now, then the mistakes that taught a rule. Check this before touching the backend, the demo, or anything public.

## Open now

| Problem | Effect | Fix |
|---|---|---|
| `rules.test.ts:204` expects `needs_help` for a pressed 2; code returns `urgent` since 0d02c7e | 1 of 25 tests fails | Test looks stale given the commit message. Confirm the intent, then update it |
| No CI (`.github/workflows` is absent) | Failing tests reach `main` unnoticed | Run tests by hand before merging |
| Key-blocking pre-commit hook is only in Dominic's `.git/hooks` | Teammates' clones don't get it | Be careful, or version the hook |
| `README.md`, SPEC §1–2 and §4 describe the old victim-first flow and points | New devs and judges get the wrong product | Trust order is in [[Home]] |
| `docs/demo-plan.md` says "NOT BUILT"; `docs/checkin-plan.md` says "not published" | Both are out of date | Prefer `docs/demo-script.md` |
| `.claude/orchestrate/status.md` is dated 11-07 | Lists shipped work as planned | Update before relying on it |
| Photon project ID is in `docs/HANDOFF-PROMPT.md` | Identifier, not a key, but public | Remove if you tidy that file |
| SPEC §13 says every rank, claim and override is logged | No log table exists | Don't say it to judges until it's built |
| Browser tab title is "SpacetimeDB React App" (`index.html`) | Looks like a template | Rename it |

## Demo

- Bridge not running: the phone never dings.
- Dings but no ring: Calls off. **End storm turns calls off**, so use Reset demo between judges.
- Don't press Reset team phones: everyone has to JOIN again.
- ElevenLabs free plan has 15 minutes in total. Check before judging, and keep test calls short.
- Only one bridge at a time. Two pollers submit everything twice.
- Use a phone hotspot if venue Wi-Fi drops.

## Backend

- Module changes don't deploy on push. They need a publish from Dominic's terminal.
- After a module change: regenerate and commit `src/module_bindings`, republish, restart the bridge. Old bindings crash it.
- Maincloud is shared. Reset clears it for everyone. Use the sandbox for front-end work.
- Reducers can't do network calls. New side effects go through `outbox`.
- A public table is readable by anyone who connects, whatever the screen hides. Personal data belongs in private tables, served through per-user views.
- `spacetime call` needs `--no-config`, or `spacetime.local.json` picks the wrong database.

## Repo and process

- **The repo is public.** No phone numbers, keys, or personal data in commits, docs, or this vault.
- Run the build alone and check it before committing. A failed build was pushed when chained with commit and push.
- A push to `main` deploys the site in about a minute.
- Don't edit `src/module_bindings/`. It's generated.
- Give Claude-powered teammates areas, not tickets. One ticket list got done in one oversized PR.
- Check a PR's author before naming whose work it is.

## On stage

- Don't call fake households real.
- Don't say the AI decides priority.
- Don't claim 911 integration, SMS or WhatsApp exist today.
- A bare "2" has no details, so it lands at P3. For the encore, type the full situation.

Related: [[Decisions]], [[Features]].
