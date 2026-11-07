# Teammate guide (front end)

The live website: **https://nobody-missed.vercel.app**
It updates by itself about 1 minute after anything is pushed to `main`. Every pull request also gets its own preview link (Vercel posts it on the PR).

## Who owns what

- **Dorothy:** the case list (rows, red rows, Claim/Release/Resolve) in `src/Board.tsx`
- **Kevin:** top bar, name prompt, side panel
- **Will:** `/victim-sim` page (`src/VictimSim.tsx`), pitch, sponsor questions
- **Dominic:** `spacetimedb/`, `bridge/`, keys, texts and calls

Only change your own area. Inject 2,000 and Reset are locked to Dominic.

## One-time setup (about 10 minutes)

1. Install **Node 24**: https://nodejs.org (pick the "24" download).
2. Install **Git**: https://git-scm.com/downloads
3. Open a terminal and run:

   ```bash
   git clone https://github.com/katsudom/nobody-missed.git
   cd nobody-missed
   npm install
   ```

That's it. You do **not** need SpacetimeDB, API keys, or any accounts.

## Every time you work

```bash
git pull
npm run dev
```

Open http://localhost:5173. Your copy talks to the same live online database as everyone else, so you see real data.

**Careful:** the database is shared. "Reset demo" clears it for everyone.

## What you can change

- **Yours:** everything in `src/` (the responder board). Don't edit `src/module_bindings/`. It's generated.
- **Ask Dominic first:** `spacetimedb/` (the backend) and `bridge/`. Changes there need to be published from Dominic's laptop.

## Saving your work

```bash
git checkout -b your-name
git add -A
git commit -m "what you changed"
git push -u origin your-name
```

Then open a pull request on GitHub and ask someone to merge it.

## Prompt for your Claude Code

After cloning, open the `nobody-missed` folder in Claude Code and paste:

```
Read SPEC.md (sections 1, 2 and 6) and TEAMMATES.md before doing anything.
I'm working on the responder board in src/ only. The backend is a SpacetimeDB
module that's already published online; the generated client is in
src/module_bindings/ (don't edit it). Don't change spacetimedb/ or bridge/.
Don't add features outside SPEC.md. Run `npm install` if node_modules is
missing, then `npm run dev`. Work on a branch named after me, commit small
steps, and open a pull request when a piece works.
Today I'm building: <describe your part, e.g. "the row layout with highlighted words">
```
