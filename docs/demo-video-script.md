# Demo video: recording script (3:30)

This is a product demo, not a slide talk. Everything is recorded on **one laptop**, in segments
that are joined in the edit. The "phone" is the Jaanch website in Chrome's mobile view, so no
phone mirroring is needed.

**Cast.** _Narrator_ (voice-over, calm, plain English with a few Hindi words). _Riya_, a 24-year-old
first-time investor from Indore, appears only through her screen.

**Track:** A, Digital Fraud & Scam Resilience.

---

## Links and files

| What                       | Where                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| Jaanch website (live)      | **https://jaanch-api.onrender.com/** (Render serves both the website and the API)           |
| Health check (wakes it up) | https://jaanch-api.onrender.com/healthz                                                    |
| Data freshness             | https://jaanch-api.onrender.com/api/v1/sources (SEBI `asOf` should be today or yesterday) |
| Fake WhatsApp chat (EN)    | `file:///C:/Codeing/Jaanch/demo/chat-mock.html#scam-en`                                    |
| Fake WhatsApp chat (HI)    | `file:///C:/Codeing/Jaanch/demo/chat-mock.html#scam-hi`                                    |
| Screenshot to upload (EN)  | `C:\Codeing\Jaanch\demo\screenshots\scam-en.png`                                           |
| Screenshot to upload (HI)  | `C:\Codeing\Jaanch\demo\screenshots\scam-hi.png`                                           |
| Architecture diagram       | `file:///C:/Codeing/Jaanch/docs/architecture.html` (first diagram; screenshot it)          |
| Report / "already paid"    | `https://jaanch-api.onrender.com/r/<id>` and `https://jaanch-api.onrender.com/r/<id>/paid` |

> `jaanch.vercel.app` is **not** this project. It is someone else's site. Don't use it or show it.

Copy both PNGs into a folder `Desktop\demo` before recording, so the file picker opens in one click.

---

## How to record

### Laptop or phone: laptop only

Record everything on the laptop. For the "phone" scenes, use Chrome's mobile view of the real
site:

1. Open the site and press **F12**, then **Ctrl+Shift+M**. Pick **Pixel 7** from the device list at
   the top and set the zoom there to 100%.
2. Undock DevTools: in the DevTools ⋮ menu, choose **Dock side → Undock into separate window**, then
   minimise that window. The page stays in phone mode, and the Chrome window now shows only the
   phone.

Recording an actual phone and moving the files across adds work and looks inconsistent. The mobile
view is the same website and the same code.

### Speaking and clicking at once: don't

Record in **two passes**. Editors call the second one a voice-over:

1. **Pass 1, screen only, no talking.** Do the clicks for one segment, slowly and calmly, with the
   mic off. Pause about a second on every important thing (a stamp, a table, a button).
2. **Pass 2, voice only.** Read that segment's narration into the mic. You aren't watching the
   screen, so read from the script. Do two or three takes and keep the best.
3. **Edit.** Put the voice on the timeline first. Then trim or speed up the video to fit the voice.
   The voice leads and the video follows.

If two people are available, one can click while the other narrates live. The two-pass method is
still easier to get right.

### Segments or one continuous take: segments

Record **one file per segment** (eight segments, listed below). A mistake costs one short retake,
waiting for the server is cut out automatically, and you can record segments in any order.

### Tools (all built into Windows 11, free)

| Job          | Tool                                                       | How                                                                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Screen video | **Snipping Tool**, recording mode                          | **Win+Shift+R**, then drag across the whole screen, turn the mic **off**, and click **Start**. Click Stop when done. It saves an MP4 to `Videos\Screen Recordings`; rename it `seg3.mp4` and so on. |
| Voice        | **Sound Recorder** app (type "Sound Recorder" in Start)    | One recording per segment. Mic 15–20 cm from your mouth, in a room with curtains or a bed (less echo), fan off.                                                                                                          |
| Edit         | **Clipchamp** (in Start; sign in with a Microsoft account) | Import everything and build the timeline (see Edit steps below). Export at 1080p.                                                                                                                                        |

Loom also works for screen video, but its free plan limits length and quality, and the two-pass
method makes its webcam and live mic unnecessary. Use **OBS Studio** only if Snipping Tool doesn't
have recording on your machine (update it from the Microsoft Store first).

Earphone mics with an in-line mic are fine. A laptop's built-in mic is acceptable in a quiet room.

### Edit steps in Clipchamp

1. Make a new 16:9 video. Drag in all the segment MP4s and voice files.
2. For each segment, place the voice clip first, then the matching screen clip above it.
3. Cut dead time. Select a waiting stretch and use **Speed** (for example 4×) or split and delete
   it. Add the text "sped up" to the first wait.
4. Zoom in on verdicts: select the clip, then use **Crop** or **Zoom** (scale up to 150–200% and
   centre on the stamp). Hold it while the narrator reads it.
5. Text overlays: the hook line, "Who it's for", and the closing card (use **Text** templates).
6. Blur the registration holder's email on the report (**Effects → Blur** on a cropped overlay
   copy).
7. **Captions → Auto captions** (English), then fix the Hindi words by hand.
8. Optional music from **Content library → Audio** at about 10% volume.
9. **Export → 1080p**. Watch it once on your phone before you submit.

### The WhatsApp message

Use the chat mock (tab 1). **Don't upload an AI-generated image.** Image models garble small text
such as "INH000011431" or the UPI ID, so Jaanch would read the wrong number and the main verdict
would break. If you want a hand-held phone shot for the opening, generate a phone mockup with a
plain green screen and place `scam-en.png` over it in Clipchamp.

---

## Before you press record (30 minutes before)

1. Open https://jaanch-api.onrender.com/healthz. The free server sleeps after 15 minutes idle,
   and the first load can take about a minute.
2. Open https://jaanch-api.onrender.com/api/v1/sources and check that the SEBI `asOf` dates are
   today or yesterday.
3. **Dry run:** upload `scam-en.png` once and `scam-hi.png` once (Hindi mode). Copy both report
   URLs (`/r/<id>`) into a note. These are your backups, and they warm up the AI models.
4. Windows: turn on **Do Not Disturb** (notification bell → Do not disturb), close WhatsApp
   Desktop, Teams, mail and anything else that pops up, and hide the taskbar (taskbar settings →
   Automatically hide). Plug in the charger.
5. Chrome: use a guest window (profile icon → **Guest**), so there are no bookmarks, extensions or
   personal autofill. Turn off "Show bookmarks bar". Use page zoom 110–125% for desktop scenes.
6. Open these tabs, in this order, in the guest window:

| Tab | URL                                                     | Mode               | Used in segment |
| --- | ------------------------------------------------------- | ------------------ | --------------- |
| 1   | `file:///C:/Codeing/Jaanch/demo/chat-mock.html#scam-en` | Pixel 7 (DevTools) | 1, 2            |
| 2   | https://jaanch-api.onrender.com/                        | Pixel 7 (DevTools) | 3               |
| 3   | https://jaanch-api.onrender.com/                        | Desktop            | 4, 6            |
| 4   | backup scam report `/r/<id>`                            | Pixel 7            | 3 (backup), 5   |
| 5   | backup Hindi report `/r/<id>`                           | Desktop            | 6 (backup)      |
| 6   | `file:///C:/Codeing/Jaanch/docs/architecture.html`      | Desktop            | 7               |

DevTools device mode applies per tab. Turn it on in tabs 1, 2 and 4 separately.

7. Have Notepad open but minimised (for the evidence-summary paste in segment 5).
8. Keep this script open on your phone, not the laptop, to read from during the voice pass.

---

## Segments

### 1 · Hook (0:00–0:15)

- **Screen:** Tab ①. The WhatsApp chat from "Sharma Investments ✅" scrolls slowly past the
  registration number, the "Guaranteed 30% monthly" line and the UPI ID.
- **Narrator:** "Riya, a first-time investor in Indore, got this on WhatsApp. It quotes a SEBI
  registration number. The number is real." _(beat)_ "It just isn't theirs."
- **Edit:** In the last 3 seconds, dim the chat and show this text centred: **The registration
  number is real. It just isn't theirs.**

### 2 · The problem (0:15–0:30)

- **Screen:** A plain title card, or stay on the dimmed chat.
- **Narrator:** "Pitches like this borrow credibility: a real registration number, guaranteed
  returns, a personal UPI ID, urgency. Checking them means knowing SEBI's registers and rules,
  which most new investors in Tier-2 and Tier-3 cities, and their parents, never learn."
- **On screen:** **Who it's for:** first-time investors · regional-language users · families.
- _(Optional: add one statistic, with its source shown on screen, from the I4C/NCRP or SEBI
  annual reports. Don't use numbers you can't cite.)_

### 3 · Live investigation (0:30–1:30). The core of the demo.

| Time | Screen (tab ②, mobile view)                                                                                                                                         | Narrator                                                                                                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0:30 | Jaanch home page. Click **Add screenshots**, choose `scam-en.png`, click **Investigate**.                                                                            | "Before paying, Riya opens Jaanch. It's a website: no app, no sign-up. She uploads the screenshot."                                              |
| 0:38 | The progress list ticks through each stage. **In the edit, speed up the wait to about 5 seconds** and add a small "sped up" label.                                     | "Jaanch reads the message, lists every claim in it and checks each one against official records."                                                 |
| 0:45 | The report appears. Zoom in on the headline, then on the first stamp, **CONTRADICTED**: "SEBI's register shows INH000011431 is registered to 360 ONE … a different name." | "Claim one: the registration. The number exists, but SEBI's register shows it belongs to a different firm, one with no link to this message."     |
| 1:00 | Scroll to: 🔍 NOT FOUND (no registered "Sharma Investments"), then the warnings about guaranteed returns, "100% accuracy" and the personal UPI ID.                     | "Guaranteed 30% a month: SEBI's rules bar registered analysts from promising returns. And registered firms collect money through verified UPI IDs, not personal ones." |
| 1:12 | Click **Show evidence**. The SEBI entry appears, with an "Open the official source" link. Scroll to the table **Who is contacting you / who is registered**.          | "Every verdict links to SEBI's own website. This table is the heart of it: the same number with a different name."                               |
| 1:22 | Scroll to **Could not check**.                                                                                                                                       | "It also says what it can't check. And there's no 'safe' score. If Jaanch finds no problem, it doesn't call the message safe."                     |

**Edit:** Blur the contact email of the real registration holder in the next-steps section.

### 4 · No false alarm (1:30–1:45)

- **Screen:** Tab ③ (desktop). Click the **SIP reminder** sample, then **Investigate**. The
  report says there are no investment claims to check, and shows no warnings. Cut the wait.
- **Narrator:** "Does it flag everything about money? No. An ordinary SIP reminder raises nothing.
  Fewer false alarms means people keep trusting the warnings."

### 5 · "I already paid" (1:45–2:05)

- **Screen:** Back on the scam report (backup tab). Click **I already paid**. Show the large
  **Call 1930** button, cybercrime.gov.in, the bank and UPI complaint steps. Click **Copy evidence
  summary** and paste it into Notepad for 2 seconds.
- **Narrator:** "If Riya has already paid, every minute counts. Jaanch never asks for her bank
  details or OTP. It tells her where to go, and gives her an evidence summary ready to attach to the
  complaint."

### 6 · In Hindi (2:05–2:30)

- **Screen:** Tab ③. Switch to **हिंदी**, upload `scam-hi.png`, click Investigate (cut the wait).
  The headline reads **रजिस्ट्रेशन नंबर असली है। बस वह उनका नहीं है।** and the stamp reads
  **रिकॉर्ड से उलट**.
- **Narrator:** "The same pitch in Hindi, 'रोज़ 5% पक्का मुनाफ़ा', gets the same evidence back in
  Hindi. The wording comes from reviewed templates, not free AI text. A voice note works too, for
  people who'd rather speak than type."
- **Edit:** Add English subtitles for the Hindi text on screen.

### 7 · How it works and why you can trust it (2:30–3:05)

- **Screen:** The diagram from [architecture.md](architecture.md), exported as an image:
  **LLM reads → tools verify → code decides → LLM explains**. Add icons for the SEBI registers, the
  RBI Alert List, SEBI circulars and a lock for privacy.
- **Narrator:** "The AI only reads the message. Any quote it can't find in the message is
  discarded. Official sources do the checking: SEBI's 12 registers, refreshed daily, its cancelled
  list, RBI's Alert List and SEBI's rules with circular numbers. Fixed code, not AI, decides each
  verdict. If a screenshot is blurry, it says 'can't check' instead of guessing. Screenshots are
  deleted once read, there are no accounts, IP addresses aren't stored, and it never gives
  investment advice."

### 8 · Impact and scale (3:05–3:30)

- **Screen:** The phone report, then the home page, then the closing card.
- **Narrator:** "Anyone with a phone can take a screenshot. Jaanch turns it into official evidence
  before the money moves. It runs on free-tier hosting today. New languages only need new
  templates, and the WhatsApp channel is already built and waiting for a verified business
  account. Next come NSE/BSE caution lists and mutual-fund distributor checks."
- **Closing card:** **Jaanch · जाँच: paste it, Jaanch investigates it.** Add the live URL, the
  GitHub link and the names Dhruv Sharma · Anushika Chauhan · Pratyush Mishra.

---

## How this covers the brief

| Requirement / criterion            | Where                          |
| ---------------------------------- | ------------------------------ |
| Problem and target user            | 1, 2                           |
| Working prototype, user journey    | 3, 4, 5                        |
| Investor resilience and safety     | 3, 5                           |
| Bharat-first (Hindi, voice, web)   | 3 (no app), 6                  |
| Trust, privacy, guardrails         | 3 (no score), 5 (no OTP), 7    |
| Technical architecture             | 7                              |
| Impact and scalability             | 8                              |

## Edit checklist

- Speed up or cut every wait to under 5 seconds, and label the first one "sped up". Judges know
  real calls take time.
- Zoom in (Clipchamp "zoom" or Cap's auto-zoom) whenever the narrator reads a verdict. Keep the
  cursor still.
- Turn on auto-captions in English, then fix the Hindi words by hand.
- Use quiet background music at about −30 dB under the voice, or none.
- Export at 1080p, 30 fps. Keep the length between 3:15 and 3:45.
- Show only the demo chat. No real phone numbers or chats.
