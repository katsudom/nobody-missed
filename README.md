# Nobody Missed

**Victims text one number for help. If they go quiet, we text, then call, then flag a human. Responders use one live board.**

> "Everyone ranks requests. We chase the people who stop answering."

**Live board:** https://nobody-missed.vercel.app · **Teammates start here:** [TEAMMATES.md](TEAMMATES.md)

HackUTD 2026 · State Farm "The Worst Day, at Scale" · Spacetime · Photon. Full spec: [SPEC.md](SPEC.md).

## The flow

1. Victim texts the help line: "Mom is 82, on oxygen, power's out."
2. Board ranks it and shows why (highlighted words + the rule that fired).
3. Nobody claims it, so its priority climbs over time (capped).
4. Victim gets a check-in text: "Still need help? Reply 1 yes, 2 no."
5. No reply, so the phone rings (automated voice check-in, press 1 / 2).
6. No answer, so the case turns red: "needs welfare check" for a human.
7. A responder claims it at any point. Only one can win. Check-ins stop.

## Pieces

| Folder | What |
|---|---|
| `spacetimedb/` | SpacetimeDB module. All state, rules, timers, claims. The only backend. |
| `src/` | React responder board (`/board`, `/victim-sim`). No business logic. |
| `bridge/` | Thin Node process: Photon in, outbox out (texts, calls, Claude). Decides nothing. |
| `scripts/` | Demo helpers (inject 2,000). |

Victims have no UI. They only text and answer the phone. Responders open the board in a browser.

## Who needs what installed

| Role | Needs |
|---|---|
| Responder / judge | A browser and the board URL. Nothing else. |
| Board or module dev | Node 24, SpacetimeDB CLI, `spacetime login` |
| Bridge runner (one laptop) | Node 24, `bridge/.env` filled in |

## Setup (dev)

```bash
# 1. SpacetimeDB CLI (Windows PowerShell)
iwr https://windows.spacetimedb.com -useb | iex
# mac/linux: curl -sSf https://install.spacetimedb.com | sh
spacetime login

# 2. Install
npm install
cd spacetimedb && npm install && cd ..
cd bridge && npm install && cd ..

# 3. Run local server + module + board (auto-republishes on save)
spacetime dev --server local
```

Board: http://localhost:5173. Bridge: copy `.env.example` to `bridge/.env`, fill in, then `cd bridge && npm start`.

Never commit `.env`, `.env.local` or `.spacetimedb-token`.

## Sponsor-table answers

_To fill in (SPEC §12 step 7)._
