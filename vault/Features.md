---
title: Feature map
area: product
sources: [spacetimedb/src/index.ts, spacetimedb/src/rules.ts, bridge/src/index.ts, bridge/src/calls.ts, bridge/src/claude.ts, bridge/src/photon.ts, src/App.tsx, src/CheckinBoard.tsx, src/Board.tsx, src/DevTools.tsx, src/UndoTray.tsx, src/VictimSim.tsx]
verified: ffb6eda
---
Summary: Every feature, where it lives, and how far it's proven. "Live-tested" comes from `.claude/orchestrate/status.md` dated 2026-11-07; nobody re-ran those for this note.

## Architecture

| Folder | Role | Rule |
|---|---|---|
| `spacetimedb/` | All state, rules, timers, claims | The only backend |
| `bridge/` | Moves Photon events in, runs outbox work out | Decides nothing |
| `src/` | React responder board | No business logic |

Why the bridge exists: reducers can't do network calls, so the module writes intent rows to `outbox` and the bridge carries them out.

## Features

| Feature | Where | Proof |
|---|---|---|
| Opt in with `JOIN <name>`, confirmation text | `enrollHousehold`, `bridge/src/photon.ts` | JOIN live-tested; confirmation text not recorded |
| Start / end storm, fixed area Richardson | `startStorm`, `endStorm` | Live-tested |
| Text → re-text → call → urgent ladder | `decideCheckin` in `rules.ts`, `tick` | Live-tested |
| Reply 1 safe, anything else needs help | `checkinAfterReply` | Unit test passes. Reply 2 on a real phone not recorded by text, only by call |
| Voice check-in, press 1 or 2 | `bridge/src/calls.ts`, `checkinCallResult` | Live-tested. Behavior of 2 changed after, see [[Pitfalls]] |
| Claude fact extraction | `bridge/src/claude.ts`, `setFacts` | Live-tested |
| P1/P2/P3 with reasons and quoted words | `tierFor`, `levelFor` in `rules.ts` | Unit tests pass |
| Take case, one winner | `claimCheckin`, `claimRequest` | Transaction. Two-tab race was a build checkpoint |
| Release, Resolve | `releaseCheckin`, `resolveCheckin` | Built |
| Undo Take case / Resolve, 30 s | `undoCase`, `src/UndoTray.tsx` | Built |
| Check-in board and tabs | `src/CheckinBoard.tsx` | Live on Vercel |
| Reports board | `src/Board.tsx`, route `#/reports` | Live on Vercel |
| Old flow: victim texts first | `submitRequest`, `decideTick` | Live-tested. Kept for people not enrolled |
| Fake households | `spacetimedb/src/index.ts`, `src/policyholders.ts` | Used in every demo run |
| Inject 2,000 load test | `injectLoad`, `src/DevTools.tsx` | Built. Not in the current demo script |
| Roles: admin, teammate | `makeAdmin`, `addTeammate` | Live |
| Calls on/off switch | `setCalls`. Off by default; End storm turns it off | Live |
| Local sandbox | `npm run dev:sandbox`, `openSandbox` | Documented in `TEAMMATES.md` |
| Fallback simulator | `src/VictimSim.tsx`, route `#/victim-sim` | Built |
| Disasters map: place search, All / Tornadoes tabs, live NWS alerts | `src/DisastersMap.tsx`, route `#/disasters`. Needs `VITE_MAPBOX_TOKEN` | Browser-tested on localhost with a real token: map, tint, tabs, alert zoom, area click, search. Not yet on Vercel |

Routes are hash-based (`#/board`, `#/reports`, `#/victim-sim`). `README.md` and `TEAMMATES.md` still show `/board`-style paths.

## Priority rules

Full rules are in `docs/priority-levels.md`.

| Level | Rule |
|---|---|
| P1 | Power-dependent medical, or danger and vulnerable, or no contact |
| P2 | Danger or vulnerable |
| P3 | Everything else |

Points still exist, hidden, as a tie-breaker.

## Checks

```bash
cd spacetimedb && npm test
cd bridge && npx tsc --noEmit
npm run build
```

At ffb6eda: rule tests are 24 of 25 passing. See [[Pitfalls]].
