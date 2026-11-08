# Nobody Missed: demo script

**Pitch line:** "Everyone ranks requests. We chase the people who stop answering."

**One-liner:** State Farm checks on every policyholder in a storm by text and call. Anyone who goes quiet gets chased until a human is sent.

---

## Before judging (once)

1. **Bridge:** leave the Claude app and its terminal open. The bridge runs there under `bridge/run.ps1` and sends the texts and calls. If you closed it, open a terminal in `bridge/` and run `.
un.ps1`.
2. **Laptop:** plugged in, lid open, online. Keep a phone hotspot ready in case the Wi-Fi drops.
3. **ElevenLabs:** check on elevenlabs.io that you have a few minutes of credits left.
4. **Phone:** ringer and volume up, Do Not Disturb off.
5. Open **Dev**. The chips at the top should say **1 phone**. If it says 0, text `JOIN <her name>` from the iPhone to the Photon number. Don't press **Reset team phones**.

## Before you go on stage (every run, ~30 s)

1. Open <https://nobody-missed.vercel.app> in your admin browser, full screen.
2. Click **Dev** (bottom right).
3. **Reset** tab: click **Reset demo**. The board is empty. Don't press End storm: it turns calls off.
4. **Team** tab: turn **Phone calls** on. The chip at the top must change from **Calls off** to on, or the phone won't ring.
5. **Demo** tab: leave the panel here, ready for **Start storm**.
6. Phone on the table, face up. Timer ready.

Optional: a teammate opens the site on a second laptop to try taking the same case.

## On stage (2:00)

| Time | Do | Say |
|---|---|---|
| **0:00** | Board is empty. | "When a storm hits, 911 is flooded with calls from people who are fine, and the people in real trouble often can't call at all." |
| **0:10** | Click **Start storm**, then close the Dev panel. Hold up the phone when it dings. | "State Farm knows every policyholder in the storm zone, so we text all of them at once." |
| **0:15–0:35** | Point at a row turning **Safe**. Then open a **Report** case and show its P1/P2/P3, the reason and the highlighted words. | "This one replied 1, so they're off the list. This one replied 2, so they're ranked by risk, and we show why." |
| **0:35** | Click **Take case**. Teammate clicks it on the same case. | "Only one responder gets it, so nobody shows up at the same house twice." |
| **0:40** | Point at the **TEAM PHONE** row, pinned at the top. The re-text arrives. **Don't reply.** | "The people who matter most are the ones who go quiet. She hasn't answered, so we text again." |
| **0:50** | **Phone rings.** Hold it up, don't answer. | "Still nothing, so we call." |
| **1:10** | Her row turns **red: Urgent, no contact**. | "No answer to a text, a re-text or a call. Now a person goes to check on her." |
| **1:15** | Open the **Urgent** tab if needed, click **Take case · send someone**. | "Responders don't have to guess where to go first. The list tells them." |
| **1:25–2:00** | Close. | "Everyone ranks requests. We chase the people who stop answering." |

**Next judge:** Dev → **Reset demo** → check **Phone calls** is still on → **Start storm** when ready.

**If something goes wrong:**
- Phone doesn't ring: keep talking, point at the row's step status.
- Running long: skip the two-person claim at 0:35.
- Phone never dings: the bridge isn't running. Check its terminal.
- Dings but never rings: **Calls off**. Dev → **Team** → **Phone calls** on.

Timings assume the demo timers: re-text at 20 s, call 10 s later, urgent 20 s after that.

---

## Encore (20 s, if a judge has time)

Shows Claude working live on the real phone. One phone can't go silent and reply in the same storm, so this is a separate run.

1. Dev → **Reset** → **Reset demo**.
2. **Demo** → **Start storm**.
3. When the alert arrives, she replies with the whole situation in **one text**, not a number. Ask a judge for a sentence, or use: *"Mom is 82, on oxygen, power's out"*.
4. Within a few seconds her row becomes a **Report** at **P1**, with the reason and her words highlighted.

| Say | |
|---|---|
| "Give me any sentence someone might text in a storm." | Nobody can call it hardcoded. |
| "Claude only pulled out the facts. Our rules set the level, and a person makes the call." | Point at the highlighted words. |

- A bare **"2"** has no details to read, so it lands at **P3**. Have her type the situation.
- To show safe instead: she replies **1**, and her row flips to **Safe** right away.
- Afterward: **Reset demo** before the next judge.

---

## Voice encore (about 2 min, if a judge has time)

Shows the call itself: she answers and files a report by voice. The call starts about 30 s after **Start storm**, and the board only updates when she hangs up.

1. Dev → **Reset** → **Reset demo**. **Team** → **Phone calls** on. **Demo** → **Start storm**.
2. She ignores both texts. When the phone rings, she answers on speaker and presses **2**.
3. The voice offers the menu:
   - **Press 1, file a report.** It asks what happened. She says one sentence, such as *"Mom is 82, on oxygen, power's out"*. It says the report is filed. Her row becomes a **Report** at **P1** with her words.
   - **Press 2, send someone.** It says someone is on the way. Her row turns **red: Urgent, Asked for help**.

Hanging up or not answering at any step leaves her **Urgent**, so nobody gets dropped.
