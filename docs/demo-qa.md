# Nobody Missed: judge Q&A

**Pitch line:** "Everyone ranks requests. We chase the people who stop answering."

**One-liner:** State Farm checks on every policyholder in a storm by text and call. Anyone who goes quiet gets chased until a human is sent.

---

### Who it's for

**Who runs this, State Farm or responders?**
State Farm runs it. It owns the household list, starts the storm check-in, and its responders work the board. Policyholders never open the site; they only get texts and calls.

**Does State Farm do rescues?**
No. State Farm's Catastrophe Team handles claims, damage and supplies after a storm. "State Farm doesn't do rescues, but it knows every door. We turn that into a list of who's safe, who needs help, and who's gone silent, for the people who do rescues."

**So who actually goes out?**

| Case | Who goes |
|---|---|
| Safe (replied 1) | Nobody. They drop off the list. |
| Needs help, property (roof, tarp, hotel) | State Farm's Catastrophe Team |
| Needs help, life safety (oxygen with no power, trapped, injured) | 911 / emergency services |
| Urgent, no contact | A welfare check: local emergency management, police or the Red Cross |

**What if dispatchers are stretched thin?**
That's why this helps. Most people reply "safe" and never call 911. The rest are ranked with the reason shown, and taking a case means two crews never go to the same house. "We don't add responders. We make sure the ones that exist go to the right houses first."

**How does a case get to 911?**
Today, a State Farm responder takes the case and calls it in, with the address and reason already on screen. In production, P1 and no-contact cases would go straight to 911 dispatch screens through an integration like RapidSOS. Not built yet.

### Take case (Claim)

**What does "Take case" mean?**
A State Farm responder says "I've got this one." Only one person can take a case, and the automatic texts and calls stop.

**Does it mean help was sent?**
No. The responder then decides: send a State Farm crew, call 911, or call the household back first.

**What do Release and Resolve mean?**
- **Release:** "I can't handle this after all." The case goes back on the open list so someone else can take it. Only the person who took it can release it.
- **Resolve:** "This is done." The person got help or is fine, so the case closes.

You don't need to click either in the demo.

**What if a responder takes a case and can't get there?**
"Release puts it back on the list, so nobody gets stuck with one person."

**How does a case end?**
"Resolve closes it when they're safe."

### P1 / P2 / P3

**What do the levels mean?**
- **P1, go now:** life at risk. Power-dependent medical, or a vulnerable person in danger, or no contact at all.
- **P2, go soon:** in danger *or* vulnerable, not both.
- **P3, check when you can:** inconvenient but stable, like no power and otherwise fine.

**What are the exact rules?**
- **Power-dependent medical:** oxygen, ventilator, dialysis, insulin
- **Danger:** trapped, flooding, rising water, fire, collapse, injury
- **Vulnerable:** age 75+, a child, mobility (e.g. wheelchair), pregnant

| Level | Rule | Example |
|---|---|---|
| P1 | Power-dependent medical, **or** danger **and** vulnerable | "On oxygen, power's out" · "I'm 80 and water's rising" |
| P2 | Danger **or** vulnerable | "Ceiling collapsed" · "I use a wheelchair, elevator's out" |
| P3 | Everything else | "Power's out" · "Are shelters open?" |

Overrides: no contact after text, re-text and call → always P1. AI couldn't read it → at least P2. Waiting moves a case up (P3 → P2 after 30 min, → P1 after 15 more).

**Does the AI decide the priority?**
No. "Claude reads the message. Our rules decide the priority. A person makes the call."

**Who decided the rules?**
We did, based on common triage priorities: powered medical equipment, older adults, children, mobility, pregnancy. It's a starting point, not an official standard.

**What if the AI gets it wrong?**
Three things. The board shows the rule that fired and their exact words highlighted. If the AI can't read a message, it's held at P2 or higher for a person to check. And anyone waiting too long moves up a level.

**Any gaps?** (say it honestly)
The rules only recognize specific words, so a gas leak or chest pain isn't matched yet. Adding them is a one-line rule change, which is why we kept the AI out of the decision.

### Claude

**What does Claude do?**
It's the reader. It turns a messy text into facts:
> "my moms 82 and on oxygen and the power just went out, please hurry"
> → age 82, medical: oxygen, hazard: no power

**Does Claude read the rules and apply them?**
No. Claude never sees the rules and doesn't know what P1/P2/P3 are. Ordinary code applies the rules, so the same facts always give the same level.

**Why use Claude at all?**
People don't text in checkboxes. They misspell and use slang ("pops is on a breathing machine"). Claude understands that; plain word matching wouldn't.

**How does Claude pick which words to highlight?**
It doesn't rank words. For each fact it returns the exact words that prove it ("82", "on oxygen", "power just went out"). Those are what the board highlights. The bridge throws away any quote that isn't an exact copy of what the person typed, so Claude can't put words in anyone's mouth. A word looks important because a rule fires on it, not because Claude judged it.

### How it's built (Spacetime track)

**Where do the rules run?**
Inside the SpacetimeDB module. There's no separate server.
1. **Facts arrive:** the bridge calls the `setFacts` reducer, which applies the rules and saves the level and reasons.
2. **Every second:** a scheduled `tick` reducer re-checks open cases for waiting and no-contact, and runs the text → re-text → call → urgent chase.
3. **Taking a case** is a transaction, so only one responder can win.

The board subscribes to the tables, so every screen updates instantly with no refresh.

**What's the bridge?**
One small Node process. It turns incoming texts and call results into database calls, and carries out what the database queues: send a text, place a call, ask Claude for facts. It decides nothing. If it dies, the board still works.

### Is the data real or hardcoded?

**"How did these replies work, was it hardcoded?"**
"The 20 households are simulated, because we can't text 20 strangers at a hackathon. The phone on stage is real: that text and that call actually went out. The simulated households run through the same database, the same rules and the same timers."

**Is who replies hardcoded?**
It's randomized each storm. About 60% reply safe, 10% need help, and 30% answer late, after the re-text or the call.

**Are the help messages hardcoded?**
Yes, for the simulated households. Their messages and facts are written ahead of time, so they skip Claude. Real messages go through Claude, and the rules that set P1, P2 and P3 are the same for both.

**Why did only her row turn red?**
"We set it up for the demo so you can follow one real person. In production, anyone who doesn't answer goes red."

**Can you prove the AI part is real?**
Do the encore in `demo-script.md`: "Give me a sentence." She types what the judge says as her reply, and the board ranks it live.

**Do you ever show someone pressing 1 or 2?**
The simulated households do it on the board during the demo. The encore shows it on the real phone.

**Don't say** the fake rows are real people or live data.

### Channels

**Why iMessage, not WhatsApp or SMS?**
- **SMS:** US business texting needs a registration (10DLC) that takes days.
- **WhatsApp Business:** needs a Meta business setup, plus pre-approved message templates for alerts sent first.
- **iMessage through Photon** works this weekend.

People opt in once by texting JOIN, which is realistic for storm alerts. "Production uses a registered SMS number, with WhatsApp Business for Android."

**Calls?**
Calls go out through ElevenLabs over a phone line (SIP), so they reach any phone: iPhone, Android or landline.
