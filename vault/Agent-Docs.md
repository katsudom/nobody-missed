---
title: Agent docs
area: process
sources: [CLAUDE.md, AGENTS.md, .windsurfrules, .claude/orchestrate/project-context.md, TEAMMATES.md]
verified: ffb6eda
---
Summary: Which instruction files exist, who can see them, and what's missing. Read before adding rules for agents.

## Visibility

The GitHub repo is **public**, so everything tracked below is world-readable.

| File | What it holds | Visibility |
|---|---|---|
| `CLAUDE.md` | Generic SpacetimeDB reference | Public |
| `AGENTS.md`, `.windsurfrules` | Byte-identical copies of `CLAUDE.md` | Public |
| `.cursor/rules/`, `.github/copilot-instructions.md` | SpacetimeDB rules for other tools | Public |
| `.claude/orchestrate/*` | Project rules, status, lessons | Public |
| `vault/` | This vault | Public once committed |
| `bridge/.env` | Keys | Private, gitignored |
| `~/.claude/CLAUDE.md` | One person's global preferences | Private, per machine |
| `~/.claude/projects/.../memory/` | One person's Claude memory | Private, per machine |

## Is `CLAUDE.md` adequate?

It exists and is accurate for SpacetimeDB, but it isn't a project guide. It's about 39 KB and says nothing about Nobody Missed.

A fresh Claude session won't learn these from it:

- What the product is, or the "nobody overlooked" scope test
- Spacetime-only backend and the thin bridge
- Ask before changing the state machine, rules or flow
- Publishing is owner-only
- Public repo: no phone numbers or keys
- Commits go under katsudom with no co-author lines

Those live in `.claude/orchestrate/project-context.md`, which is read only when the orchestrate skill runs.

## Recommendation

Add a short project section at the top of `CLAUDE.md` that links to `vault/Home.md`. Check whether re-running SpacetimeDB's agent setup overwrites the file. Copy the same section to `AGENTS.md` if other tools are in use.

Related: [[Home]], [[Pitfalls]].
