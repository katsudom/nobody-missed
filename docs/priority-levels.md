# How P1 / P2 / P3 works (for the team)

**One line for judges:** "Claude reads the message. Our rules decide the priority. A person makes the call."

## The levels

- **P1, go now:** life at risk. Power-dependent medical, or a vulnerable person in danger, or no contact at all.
- **P2, go soon:** in danger *or* vulnerable, not both.
- **P3, check when you can:** inconvenient but stable (e.g. no power, otherwise fine).

## The rules (`spacetimedb/src/rules.ts`)

What counts as each fact:

- **Power-dependent medical:** oxygen, ventilator, dialysis, insulin
- **Danger:** trapped, flooding, rising water, fire, collapse, injury
- **Vulnerable:** age 75+, a child, mobility (e.g. wheelchair), pregnant

| Level | Rule | Example |
|---|---|---|
| **P1** | Power-dependent medical, **or** danger **and** vulnerable | "On oxygen, power's out" · "I'm 80 and water's rising" |
| **P2** | Danger **or** vulnerable (not both) | "Ceiling collapsed" · "I use a wheelchair, elevator's out" |
| **P3** | Everything else | "Power's out" · "Are shelters open?" |

Overrides:

- **No contact after text, re-text and call:** always P1.
- **Claude couldn't read the message:** at least P2, marked "AI couldn't read this: check it".
- **Waiting:** P3 becomes P2 after 30 min, then P1 after 15 more (real minutes, even in demo).

Within a level, hidden points break ties (medical +40, danger +30, vulnerable +20, no power/water +15, 3+ people +10). Responders only see the level and the reasons.

## What Claude does (and doesn't)

Claude is the **reader**. It turns a messy text into facts and nothing else.

> "my moms 82 and on oxygen and the power just went out, please hurry"
> → age 82, medical: oxygen, hazard: no power, plus the exact words that prove each one.

- Claude **never sees the rules** and doesn't know what P1/P2/P3 are (`bridge/src/claude.ts`).
- Ordinary code applies the rules, so the same facts always give the same level.
- The board highlights Claude's quoted words, so a responder can check them in a second.
- Fake households skip Claude: their help messages are written ahead of time with the facts already filled in.

## How the database applies the rules

All inside the SpacetimeDB module, no separate server:

1. **Facts arrive:** the bridge calls the `setFacts` reducer, which scores the facts and saves the level and reasons on the case.
2. **Every second:** the scheduled `tick` reducer re-checks open cases for waiting and no-contact rules and saves any change.
3. **Any save** re-checks the level. Claimed and closed cases keep their level.

The board subscribes to the table, so every screen updates instantly.

## If judges ask

- **"Does the AI decide priority?"** No. It only extracts facts. Fixed rules anyone can read set the level, and a person decides.
- **"What if the AI is wrong?"** The board shows the rule that fired and their exact words. If the AI can't read a message, it's held at P2+ for a person. Waiting cases move up.
- **"Who decided the rules?"** We did, based on common triage priorities (powered medical equipment, older adults, children, mobility, pregnancy). It's a starting point, not an official standard.
- **Known gap (say it honestly):** the rules only recognize specific words, so a gas leak or chest pain isn't matched yet. Adding them is a one-line rule change, which is why the AI is kept out of the decision.

## What "Take case" (Claim) means

A **State Farm responder** says "I've got this one." Only one person can take a case, and the automatic texts and calls stop. It does **not** mean help was sent: the responder then calls 911, sends a State Farm catastrophe crew, or calls the household back.
