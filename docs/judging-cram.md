# Nobody Missed: judging cram sheet

Everything to know before judges walk up: the stack, how it actually works, and an answer
for every question we expect. Cram the first page, skim the rest.

**Pitch line:** "Everyone ranks requests. We chase the people who stop answering."

**One-liner:** State Farm checks on every policyholder in a storm by text and call.
Anyone who goes quiet gets chased until a human is sent.

---

## 1. The cheat strip

Memorize these six. Most questions are one of them in disguise.

| Question | Answer |
|---|---|
| What is it? | State Farm texts every policyholder in a storm. Silence escalates to a re-text, a call, then a human. |
| Where's your server? | There isn't one. The logic runs inside the database. |
| What does the AI decide? | Nothing. Claude extracts facts, our rules set P1/P2/P3, a person makes the call. |
| How is the board live? | Subscriptions. Spacetime pushes changed rows to every screen. No polling. |
| Two people take the same case? | A reducer is one transaction, so exactly one wins. We wrote no locking code. |
| What's fake? | The 20 households are simulated. The phone on stage is real. |

---

## 2. The stack

Three pieces, nothing else.

| Piece | What it is | What it does |
|---|---|---|
| **Spacetime** (formerly SpacetimeDB) | A database that runs server logic inside it | Our database *and* our backend. Tables, ranking rules, escalation ladder |
| **React + Vite on Vercel** | The board | Subscribes to tables, renders, calls reducers |
| **Node bridge** | A worker | The only piece allowed to touch the outside world |

**Outside services:** Photon (iMessage), ElevenLabs (voice calls over SIP), Claude (fact extraction).

**Size:** 12 tables, 29 reducers, 11 public tables. 217 lines of tests on the ranking rules alone.

**The constraint that explains the architecture:** reducers must be deterministic, so they
cannot make network calls. That is why the bridge exists.

---

## 3. How it works, traced

### A storm starts

1. Click **Start storm** → calls the `startStorm` **reducer**.
2. Inside the database it creates a `checkin` row per household and writes a `send_text`
   row into the **outbox** table.
3. The bridge is subscribed to `outbox`, so the row fires `onInsert` immediately.
4. Bridge calls `takeOutbox` (queued → taken, so two bridges never double-send), sends the
   iMessage through Photon, then calls `completeOutbox`.
5. The board sees the rows change and re-renders.

### Nobody replies

1. A **scheduled reducer, `tick`, runs every second** inside the database.
2. It walks every waiting check-in and asks `decideCheckin(state, time since last step)`.
3. **20s** → re-text. **10s later** → `place_call` into the outbox. **20s later** → **Urgent**.
4. A reply at any point stops it. Taking the case stops it.

**Why this matters:** the clock lives in the database, not in a browser. Close every laptop
and the ladder keeps running.

### They text back "Mom is 82, on oxygen, power's out"

1. Bridge polls Photon, sees the message, calls `victimReplied` or `submitRequest`.
2. That reducer stops the ladder and writes an `extract_facts` row to the outbox.
3. Bridge sends the text to **Claude** (claude-sonnet-5-5, JSON schema output). Claude
   returns `{age: 82, medical: ["oxygen"], hazards: ["no_power"], quotes: [...]}`.
   It does **not** return a priority.
4. Bridge calls `setFacts`. **Inside that reducer**, `scoreFacts()` runs: +40 oxygen,
   +20 age 75+ → **P1**, reasons `medical: oxygen · vulnerable: age 82`.
5. The row updates and every board turns red at once.

**If Claude fails:** the report still enters the queue at P2. A dead API never drops a person.

### The phone call

1. `place_call` row → bridge → **ElevenLabs** places a real call over **SIP** through
   Photon's trunk.
2. The voice asks if they're safe. Press **1** → safe. Press **2** → a menu: file a report,
   or have someone sent.
3. Bridge polls the conversation every 3s until it ends, reads the transcript, calls
   `checkinCallResult`.
4. A spoken report goes through Claude and is ranked exactly like a text.

Silence or a hang-up at any step → **Urgent**. Nobody is dropped.

### Two responders press Take case

Both call `claimCheckin`. A reducer is one transaction, so the first sets `claimedBy` and
the second fails with "already taken by". That is the database doing it, not our code.

---

## 4. The ranking

**Claude extracts facts. Our rules set the level.** That split is the whole answer.

### Score

Starts at 10, then:

| Add | For |
|---|---|
| **+40** | Power-dependent medical: oxygen, ventilator, dialysis, insulin |
| **+30** | Danger: trapped, flooding, rising water, fire, collapse, injury |
| **+20** | Vulnerable: age 75+, a child, mobility (wheelchair), pregnant |
| **+15** | Utilities out |
| **+10** | Three or more people |

Time waiting adds to the score too, so an ignored case climbs on its own.

### Level

| Level | Rule | Example |
|---|---|---|
| **P1, go now** | Power-dependent medical, **or** danger **and** vulnerable | "On oxygen, power's out" · "I'm 80 and water's rising" |
| **P2, go soon** | Danger **or** vulnerable | "Ceiling collapsed" · "I use a wheelchair, elevator's out" |
| **P3, when you can** | Everything else | "Power's out" · "Are shelters open?" |

**Overrides:** no contact after text, re-text and call → always P1. AI couldn't read it →
at least P2. Waiting moves a case up (P3 → P2 after 30 min, → P1 after 15 more).

---

## 5. Q&A

### Who it's for

**Who runs this, State Farm or responders?**
State Farm runs it. It owns the household list, starts the storm check-in, and its
responders work the board. Policyholders never open the site; they only get texts and calls.

**Does State Farm do rescues?**
No. State Farm's Catastrophe Team handles claims, damage and supplies after a storm.
"State Farm doesn't do rescues, but it knows every door. We turn that into a list of who's
safe, who needs help, and who's gone silent, for the people who do rescues."

**So who actually goes out?**

| Case | Who goes |
|---|---|
| Safe (replied 1) | Nobody. They drop off the list. |
| Needs help, property (roof, tarp, hotel) | State Farm's Catastrophe Team |
| Needs help, life safety (oxygen with no power, trapped, injured) | 911 / emergency services |
| Urgent, no contact | A welfare check: local emergency management, police or the Red Cross |

**What if dispatchers are stretched thin?**
That's why this helps. Most people reply "safe" and never call 911. The rest are ranked with
the reason shown, and taking a case means two crews never go to the same house. "We don't add
responders. We make sure the ones that exist go to the right houses first."

**How does a case get to 911?**
Today, a State Farm responder takes the case and calls it in, with the address and reason
already on screen. In production, P1 and no-contact cases would go straight to 911 dispatch
screens through an integration like RapidSOS. Not built yet.

**How does the system tell a nap from an emergency?**
It can't, and it doesn't guess. Silence looks the same either way, so everyone silent is
treated as possibly in trouble. The steps get louder: text, re-text, then a phone call, which
is what wakes a napper. "A false alarm costs a responder one check. A wrong guess could cost
a life."

### Take case, Release, Resolve

**What does "Take case" mean?**
A State Farm responder says "I've got this one." Only one person can take a case, and the
automatic texts and calls stop.

**Does it mean help was sent?**
No. The responder then decides: send a State Farm crew, call 911, or call the household back.

**What do Release and Resolve mean?**

- **Release:** "I can't handle this after all." The case goes back on the open list. Only the
  person who took it can release it.
- **Resolve:** "This is done." The person got help or is fine, so the case closes.

Neither is needed in the demo. There's also a 30-second **Undo** after either.

### The AI

**What does Claude do?**
It's the reader. It turns a messy text into facts:
> "my moms 82 and on oxygen and the power just went out, please hurry"
> → age 82, medical: oxygen, hazard: no power

**Does Claude read the rules and apply them?**
No. Claude never sees the rules and doesn't know what P1/P2/P3 are. Ordinary code applies the
rules, so the same facts always give the same level.

**Why use Claude at all?**
People don't text in checkboxes. They misspell and use slang ("pops is on a breathing
machine"). Claude understands that; plain word matching wouldn't.

**How does Claude pick which words to highlight?**
It doesn't rank words. For each fact it returns the exact words that prove it ("82",
"on oxygen", "power just went out"). The bridge throws away any quote that isn't an exact
copy of what the person typed, so Claude can't put words in anyone's mouth. A word looks
important because a rule fired on it, not because Claude judged it.

**What if the AI gets it wrong?**
Three things. The board shows the rule that fired and their exact words highlighted. If the
AI can't read a message, it's held at P2 or higher for a person to check. And anyone waiting
too long moves up a level.

**Who decided the rules?**
We did, based on common triage priorities: powered medical equipment, older adults, children,
mobility, pregnancy. A starting point, not an official standard.

**Any gaps?** (say it honestly)
The rules only recognize specific words, so a gas leak or chest pain isn't matched yet.
Adding them is a one-line rule change, which is exactly why we kept the AI out of the decision.

### Spacetime

**Where do the rules run?**
Inside the Spacetime module. There is no separate server.

1. **Facts arrive:** the bridge calls `setFacts`, which applies the rules and saves the level
   and the reasons, in one transaction.
2. **Every second:** a scheduled `tick` reducer re-checks open cases and runs the
   text → re-text → call → urgent ladder.
3. **Taking a case** is a transaction, so only one responder can win.

**Isn't Spacetime just your database?**
It's our database *and* our backend. That's the point: the ranking rules and the storm timer
are reducers running inside it, not a server beside it. No API server, no ORM, no WebSocket
layer to build.

**How is the board live?**
11 of our 12 tables are public. Clients subscribe by query, and when a reducer changes a row,
Spacetime pushes it to every subscribed client. In React that's `useTable`, and the component
re-renders. No polling, no refetching.

**Reducers can't make network calls, so how do you text?**
The reducer writes a row to an **outbox** table. The bridge subscribes to it, sends the
iMessage or places the call, and writes the result back by calling another reducer. The
database stays the source of truth and the outside world is just a worker.

**What's the bridge?**
One small Node process. It turns incoming texts and call results into reducer calls, and
carries out what the database queues: send a text, place a call, ask Claude for facts. It
decides nothing and holds no state. If it dies, the board still works.

**Does Spacetime do your primary functionality?** (their prize rule)
Yes. The P1/P2/P3 ranking and the whole escalation ladder are reducers. It isn't just chat
or storage.

### Is the data real or hardcoded?

**"How did these replies work, was it hardcoded?"**
"The 20 households are simulated, because we can't text 20 strangers at a hackathon. The
phone on stage is real: that text and that call actually went out. The simulated households
run through the same database, the same rules and the same timers."

**Is who replies hardcoded?**
It's randomized each storm. About 60% reply safe, 10% need help, and 30% answer late, after
the re-text or the call.

**Are the help messages hardcoded?**
Yes, for the simulated households. Their messages and facts are written ahead of time, so
they skip Claude. Real messages go through Claude, and the rules that set P1, P2 and P3 are
the same for both.

**Why did only her row turn red?**
"We set it up for the demo so you can follow one real person. In production, anyone who
doesn't answer goes red."

**Can you prove the AI part is real?**
Do the encore: "Give me a sentence." She texts whatever the judge says, and the board ranks
it live.

**What happens if someone answers the call and needs help?**
They choose: press 1 to describe what happened, which files a ranked report in their own
words, or press 2 to have someone sent, which goes straight to Urgent. A hang-up or silence
leaves them Urgent.

**Don't say** the simulated rows are real people or live data.

### Channels

**Why iMessage, not WhatsApp or SMS?**

- **SMS:** US business texting needs a registration (10DLC) that takes days.
- **WhatsApp Business:** needs a Meta business setup, plus pre-approved templates for alerts
  sent first.
- **iMessage through Photon** works this weekend.

People opt in once by texting JOIN, which is realistic for storm alerts. "Production uses a
registered SMS number, with WhatsApp Business for Android."

**Calls?**
Calls go out through ElevenLabs over a phone line (SIP), so they reach any phone: iPhone,
Android or landline.

### Privacy

**Are you showing real phone numbers?**
The board masks them: `•••-•••-2613`. A responder sees enough to confirm the right person.
Searching the full number still works.

---

## 6. If something breaks on stage

- **Phone doesn't ring:** keep talking and point at the row's step status. The ladder still
  moves without the call.
- **Nothing arrives at all:** the bridge stopped. Say "our bridge process is on my laptop and
  it dropped" and demo the simulated households, which don't need it.
- **Running long:** skip the two-person claim.
