---
title: Product scope
area: product
sources: [docs/demo-script.md, docs/demo-qa.md, docs/priority-levels.md, spacetimedb/src/rules.ts]
verified: ffb6eda
---
Summary: What we're building, for whom, and what's out of scope. Read this first if you're new. Feature-level detail is in [[Features]].

## In one line

State Farm checks on every policyholder in a storm by text and call. Anyone who goes quiet gets chased until a human is sent.

Pitch: "Everyone ranks requests. We chase the people who stop answering."

**Scope test (SPEC.md):** does it help make sure nobody is overlooked? If not, cut it.

**Direction:** something judges and companies can picture using day to day. Demo moments and likely adopters are in [[Showcase]].

## Who uses it

| Person | What they touch |
|---|---|
| Policyholder | Texts and phone calls only. No app, no site. |
| State Farm responder | The live web board |
| Admin / teammate | Dev panel: start a storm, reset, calls switch |

State Farm doesn't do rescues. It produces the list of who's safe, who needs help and who's silent. The people who go out are in `docs/demo-qa.md`.

## The core loop

1. **Enroll.** A phone texts `JOIN <name>` to opt in.
2. **Storm starts.** Everyone in the area gets a text: reply 1 if safe, 2 if you need help.
3. **Reply 1:** safe, off the list.
4. **Reply 2 or any other text:** becomes a report. Claude pulls out facts, rules set P1/P2/P3, the board shows why.
5. **Silence:** re-text, then phone call, then red "Urgent, no contact".
6. **Take case.** Exactly one responder wins, and the chasing stops.

Demo timers: re-text at 25 s, call 20 s later, urgent 20 s after that.

## The three ideas that matter

- **Chase the silent.** This is the differentiator. Protect it first.
- **AI reads, rules rank, people decide.** Claude never sees the rules. Same facts, same level.
- **One winner per case.** Claiming is a database transaction, so two crews don't go to one house.

## Real vs simulated

- Real: team phones, their texts and calls, the rules, the timers, the database.
- Simulated: the 20 fake households and their replies. They skip Claude.
- Say this plainly if asked. Never call fake rows real people.

## Out of scope

- A victim-facing app or site
- A map on the check-in board (team decision; the separate Disasters page has one)
- Real SMS or WhatsApp: SMS needs 10DLC registration, WhatsApp needs Meta setup
- 911 integration such as RapidSOS: pitch only, not built
- Any Claude role in deciding priority

## Known product gaps

- Rules only match specific facts. A gas leak or chest pain isn't matched yet.
- Priority rules are ours, based on common triage priorities. Not an official standard.
- Photon's free shared line means each phone needs its own assignment and must text first.
