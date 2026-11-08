---
title: Home
area: index
sources: [SPEC.md, docs/demo-script.md, docs/demo-qa.md]
verified: ffb6eda
---
Summary: Start here. Nobody Missed is a storm check-in system for HackUTD 2026: Zero Day. Read one note below, then stop.

**This vault is in a public repo.** Never write phone numbers, keys, or personal details here.

**Deadline: final Devpost submission, noon Sunday 2026-11-08. No edits after that.**

| Need | Read |
|---|---|
| What the product is and what's in scope | [[Product-Scope]] |
| Every feature, where it lives, whether it's proven | [[Features]] |
| Track requirements, and where we're weak | [[Judging]] |
| What's demoable, and who could adopt it | [[Showcase]] |
| Why it's built this way | [[Decisions]] |
| What has burned us | [[Pitfalls]] |
| Which instruction files exist, public or private | [[Agent-Docs]] |

Current work state stays in `.claude/orchestrate/status.md`.

## Which doc to trust

When docs disagree, use this order:

1. Code: `spacetimedb/src/rules.ts`, `spacetimedb/src/index.ts`
2. `docs/demo-script.md`, `docs/demo-qa.md`, `docs/priority-levels.md`
3. This vault
4. `SPEC.md`: right for architecture and vendor setup, out of date for the flow and scoring

## Keeping it true

- Update a note when it's wrong. Don't add a diary.
- `Decisions` is append-only and dated.
- `verified:` is the commit the note was last checked against.
