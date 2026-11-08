---
title: Judging and tracks
area: hackathon
sources: [README.md, SPEC.md, docs/demo-script.md, docs/demo-qa.md, bridge/src/photon.ts, bridge/src/calls.ts]
verified: ffb6eda
---
Summary: The official requirements for our three tracks and the general criteria, mapped to evidence and gaps. Copied 2026-11-08 from Devpost, the sponsor pages and the opening-ceremony slides. Gap ratings are our own read.

Sources: [Devpost](https://hackutd-zeroday.devpost.com/), [Sponsor Tracks](https://hackutd-2026.notion.site/Sponsor-Tracks-3bd63cec7740808c9e89e4e25cee23e7), [Photon guidelines](https://somethingreat.notion.site/Hackathon-Guidelines-for-Photon-2-0-3f8e443f36bb81f9893fed0d08a4c01d), ceremony slides.

**Our tracks: State Farm, Spacetime Main, Photon.** How we show them off: [[Showcase]].

## Submission must-haves (noon Sunday, no edits after)

- [ ] Title and description
- [ ] Code repository link
- [ ] Tracks selected on Devpost: State Farm, Spacetime, Photon
- [ ] **Demo video, 2 minutes max** (skits allowed). None is in the repo; check whether one exists elsewhere.

Limits: up to 3 sponsor tracks plus 1 HackUTD track (Best Hardware, Best Design, or Virality). Our sponsor slots are full. **The HackUTD slot is unused.** Every project is in the General Track automatically.

## State Farm: The Worst Day, at Scale (Intelligent Catastrophe Response)

> When a major disaster affects thousands of people simultaneously, how might we use AI and technology to identify those with the most urgent needs, coordinate assistance, and ensure no one is overlooked?

Prizes: Beats Studio Pro, RC drone, portable monitor. No rubric is published, so the prompt is the rubric.

| Requirement | Our answer | Status |
|---|---|---|
| Thousands at once | `injectLoad` adds 2,000 reports | **Gap:** Reports board only, storms alert at most 20 fake households, not in the script |
| AI and technology | Claude extracts facts from messy texts | Real |
| Identify most urgent | P1/P2/P3 with reason and quoted words | Real |
| Coordinate assistance | Take case, one winner, Release/Resolve | Real. Handoff to 911 or a crew is manual |
| No one is overlooked | Text → re-text → call → urgent, plus `no_reply` | Real, and our strongest point |

## Spacetime Main Track

Prizes: $2,048 / $1,024 / $512 per team.

| Requirement | Status |
|---|---|
| "Spacetime must power the app's primary functionality, not just chat or player movement" (slide) | Met: state, rules, timers, claims all in the module |
| Majority of backend on Spacetime (sponsor page) | Met: the bridge only moves events |
| Public source code on GitHub, required to win | Met: repo is public |

No scoring rubric is published. ScrabbleBot was a separate tournament on Saturday night (slide says 10:45 PM, sponsor page says 11 PM); we didn't enter it as far as the repo shows.

## Photon

Prizes per team: Track Winner $700 ($400 cash, $300 credits, final-interview fast-track), Runner-Up $300, Voice Call Winner $400. The Voice prize is separate and standalone.

| Requirement | Status |
|---|---|
| Integrate with Photon 2.0 / API (slide) | Met: `bridge/src/photon.ts` uses the v1 REST API |
| Live on at least one Photon channel (guidelines) | Met: iMessage. Voice on an SMS number via SIP |

Judged on: **Vision** (hybrid intelligence), **Craft** (cohesive, responsive), **Depth** (real-world context, edge cases), **Traction** (could run with real users tomorrow).

| "What great looks like" | Us |
|---|---|
| Real human-in-the-loop | Yes: a responder takes every case |
| Safety and fallbacks | Yes: retry ladder, failed call goes urgent, AI failure held at P2 |
| Context across time and channels | Partial: text and call results land on one check-in |
| Voice: natural turn-taking, low latency | Thin: scripted press-1-or-2 call |
| Voice: remembers the call back on text | **Not built.** `checkinCallResult` sends nothing after a call |
| Voice: real calls in and out | Outbound proven. No inbound test recorded |

Slide says calls run "on an SMS number and iMessage"; the guidelines say iMessage calls need a dedicated line. We use the SMS number, which fits both.

## General Track criteria

| Criterion | Our evidence | Weak spot |
|---|---|---|
| Innovation | Chasing silence instead of ranking reports | Say why ranking alone fails |
| Technical complexity | Scheduled state machine in the database, atomic claims, real SIP calls | Invisible unless shown |
| Completeness | Full ladder on a real phone | 1 failing test, stale README |
| Design | Live board, tabs, reasons on each row | Browser tab still says "SpacetimeDB React App" |
| Impact | Named users and who goes out (`docs/demo-qa.md`) | Rules aren't an official standard |
| Presentation | Timed 2-minute script, judge Q&A | Depends on rehearsal and the phone ringing |

Why it's built this way: [[Decisions]]. Product: [[Product-Scope]].
