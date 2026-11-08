---
title: Decisions
area: index
sources: [SPEC.md, docs/checkin-plan.md, docs/demo-plan.md, .claude/orchestrate/status.md, .claude/orchestrate/project-context.md]
verified: ffb6eda
---
Summary: Dated major decisions and why. Append-only: to reverse one, add a new entry. Reconstructed on 2026-11-08 from repo docs and git history.

Ask Dominic before changing the state machine, scoring rules, or flow.

| Date | Decision | Why | Source |
|---|---|---|---|
| 11-07 | Spacetime is the only backend and database | Sponsor track scores this; it qualifies only if most of the backend is on Spacetime | SPEC §3 |
| 11-07 | Bridge is thin and decides nothing | Reducers can't do network calls; board survives if the bridge dies | SPEC §3 |
| 11-07 | Claude only extracts facts; plain code ranks; a human decides | Explainable, repeatable, and answers the ethics question | SPEC §13 |
| 11-07 | iMessage through Photon, not SMS or WhatsApp | 10DLC takes days; personal WhatsApp isn't released | SPEC §7b |
| 11-07 | Calls via ElevenLabs over Photon SIP | Photon has no create-call API; reaches any phone | SPEC §8–9 |
| 11-07 | Public repo | Spacetime requires it to win | SPEC §10 |
| 11-07 | Admin-only destructive and demo reducers | Unauthenticated buttons let someone inject 20k rows | lessons.md |
| 11-07 | Add injury +30 and pregnancy +20 | Owner-approved rule change | status.md |
| 11-07 | Wait 10 units after a "1" before the next check-in | Don't re-text someone who just answered | `T1_AFTER_REPLY` |
| 11-07 | Flip from "victim texts first" to "we text the zone first" | The pitch is chasing silence, but the board only showed people who'd already texted | `docs/checkin-plan.md` |
| 11-07 | Keep the victim-texts-first path | Works for people not enrolled | `docs/checkin-plan.md` |
| 11-07 | No map; PR #16's site wins over #15 | Dominic chose #16 in full | status.md, b2f8463 |
| 11-07 | Storm always hits Richardson | Predictable demo | `STORM_AREA` |
| 11-07 | Calls off by default, admin switch | ElevenLabs free plan is 15 minutes total | status.md |
| 11-07 | Call says "automated emergency check-in", no State Farm name | Wording choice recorded in status | status.md |
| 11-08 | P1/P2/P3 replace the visible score | Responders need a level and reason, points stay as tie-break | `docs/priority-levels.md` |
| 11-08 | Demo ladder 25/20/20 s; only team phones go urgent | Lets the audience follow one real person | `docs/demo-script.md`, `S1_RETEXT` |
| 11-08 | Pressing 2 on a call goes urgent | Commit says "help goes urgent" | 0d02c7e |
| 11-08 | 30-second undo on Take case and Resolve | Recover from a misclick | PR #34 |
| 11-08 | Mask team phone numbers on screen | Numbers are projected on stage | PR #35 |
| 11-08 | Tracks: State Farm, Spacetime Main, Photon. Build toward real client adoption, keeping the creative edge | Judges and companies should see themselves using it | [[Showcase]] |
| 11-08 | Add a Disasters page with a Mapbox map, reversing "no map" for this page only; the check-in board stays map-free | Requested for situational awareness. Live NWS alerts avoid invented disaster data | `src/DisastersMap.tsx` |
| — | Commits under katsudom only, no co-author lines | Owner's rule | project-context.md |

Dates for 11-08 rows are the merge night; exact order is in git.

## Open

- Should reply 2 send a confirmation text? SPEC has none.
- After a storm "needs help", the report also runs the old text-and-call chase. Wanted?
- Should the old victim-first flow call only after 2 unanswered texts?

Related: [[Pitfalls]], [[Product-Scope]].
