# Demo plan (2 minutes) — PLANNED, NOT BUILT

Agreed with Dominic 2026-11-07. Build after Step 7 (phone calls) works.

## Setup before the demo
- Two team iPhones, each added as a Photon iMessage assignment and each has texted `JOIN`.
- Every storm hits one fixed area: Richardson. Every team phone + 20 fake households get the alert at once.
- Board in **Real phones** mode (Dev tools switch) unless showing fake data.

## Timeline: both phones ding together, then the story splits so nothing overlaps

| Time | Phone A (answers) | Phone B (silent) |
|---|---|---|
| 0:00 | Presenter presses Start storm, both phones ding | |
| 0:05 | Replies **2** → becomes a ranked help case | |
| 0:05–0:25 | Presenter walks the board while B stays quiet | silent |
| 0:25 | | Re-text arrives ("We have not heard from you…") |
| 0:45 | | **Phone rings on stage** (Step 7) |
| 1:05 | | No answer → turns red: **Urgent** |
| 1:05–2:00 | Presenter claims B's case, wraps up | |

## Changes to build (about 20 min + one module publish)
1. Demo storm timers: re-text at **25 s**, call **20 s** later, urgent **20 s** after the call. Today: re-text at 15 s, call 10 s, urgent 10 s (`spacetimedb/src/rules.ts`, storm ladder constants).
2. **Skip ahead** button in Dev tools (teammates + admin): moves a silent household to its next step now. Backup only, if pacing runs slow on stage.

Why timers, not buttons only: the pitch is "we chase the people who stop answering", so the chase must happen on its own. Read receipts were considered and dropped (unreliable, people turn them off).
