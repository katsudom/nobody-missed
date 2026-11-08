---
title: Showcase and adoption
area: product
sources: [docs/demo-script.md, docs/demo-qa.md, spacetimedb/src/index.ts, spacetimedb/src/rules.ts, bridge/src/index.ts, bridge/src/claude.ts, src/CheckinBoard.tsx, src/DevTools.tsx]
verified: ffb6eda
---
Summary: Which demo moments are real, what each proves, and who could adopt this. Read before changing the demo or proposing a feature. Requirements are in [[Judging]].

**Direction (2026-11-08):** build what a judge or company can picture using in their own day. Client-first, but keep the strange part: software that refuses to stop asking if you're okay.

**Test for any new idea:** can a judge get it in 10 seconds, does it show a sponsor's tech doing something others can't easily do, and would a real client use it on a normal workday?

## Demo moments

| Moment | What the judge thinks | Tech advantage shown | Track | Status |
|---|---|---|---|---|
| **The phone rings.** Ignore the text, the re-text, then it rings on stage, then the row goes red | "That could be my mom" | Text and voice as one chase | All | **Ready.** Live-tested |
| **Two laptops, one case.** Both click Take case | "Two crews won't go to one house" | Atomic transaction, no locking code | Spacetime | **Ready** |
| **Any sentence.** A judge dictates a text and the board ranks it | "Nobody hardcoded that" | AI reads, rules decide | State Farm | **Ready** in English |
| **Any language.** Same, in Spanish or Vietnamese | "My neighbors could use this" | Same pipeline, no new code | State Farm | **Needs one test.** Prompt has no language limit, but it's untried |
| **Pull the plug.** Kill the bridge mid-storm: the ladder keeps moving, and restart sends what queued | "Where's the server?" | The database is the server | Spacetime | **Needs a rehearsal.** Code supports it: `tick` is in the module, and the bridge sweeps the outbox on connect. Video it if risky live |
| **Thousands, live.** Huge storm, board stays smooth | "This survives the real day" | Live subscriptions under load | State Farm, Spacetime | **Needs a load test.** Storms cap at 20 fakes; Inject is Reports-only |
| **The call remembers.** Press 2, then get a text: "You told us you need help. What's happening?" | "It knows what just happened" | Voice and text share context | Photon Voice | **Not built.** Small module change, plus linking the reply to the check-in |
| **Put the judge in the storm.** Their own phone gets the alert | "It's texting me" | Real iMessage, real call | All | **Blocked for now:** needs a Photon assignment per phone (25 max), iPhone only, and judge numbers kept private |

## Order of work, deadline noon Sunday

1. Keep personal data out of public tables ([[Pitfalls]]).
2. Record the 2-minute video using "the phone rings".
3. Fix README, browser tab title, failing test.
4. Test "any language" with one text. No call minutes needed.
5. Rehearse "pull the plug".
6. Load-test in the local sandbox and put a real number in the pitch.
7. Build "the call remembers" if time remains: it's the direct answer to Photon's voice criteria.

Items 6 and 7 touch the module. Ask Dominic first; publish is owner-only.

## Who could adopt this

Hypotheses. No client has validated any of these.

| Client | Their normal day | What they'd use it for |
|---|---|---|
| State Farm catastrophe teams | Work a policy list after a storm | Know who's safe, who needs help, who's silent |
| Utilities | Warn medical-equipment customers about outages | Confirm oxygen and dialysis households were actually reached |
| Senior living, home health | Account for residents and patients | Roll call with escalation to a named staff member |
| Universities, large employers | Campus or site emergencies | Know who's accounted for, with one owner per missing person |

For insurers, the pitch to test: every "safe" reply may be one less inbound call, and every "needs help" reply could start the claim sooner. Don't quote numbers; we have none.

**Expect this question:** mass-notification products already send polls (Everbridge is one; check its current features before naming it). Our answer: the voice chase, the reason shown for each rank, and one responder owning each case.

## What a real client would need

| Need | Today |
|---|---|
| Personal data visible only to authorized staff | Screen masking only |
| Load their policyholder list | `JOIN` and seeded fakes only |
| "Who goes" on each case: 911, crew, or welfare check | Described in `docs/demo-qa.md`; the board shows only "send someone" or "welfare check" |
| After-action log of ranks, claims, overrides | **Not built.** No log table exists |
| Registered SMS or a dedicated line | iMessage shared line, pitched as production path |

Say these are the roadmap. Don't imply they exist.
