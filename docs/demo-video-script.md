# Demo video: recording script (3:30)

This is a product demo, not a slide talk. Everything is recorded on **one laptop**, in segments
that are joined in the edit. The "phone" is the Jaanch website in Chrome's mobile view, so no
phone mirroring is needed.

**Cast.** _Narrator_ (voice-over, calm, plain English with a few Hindi words). _Riya_, a 24-year-old
first-time investor from Indore, appears only through her screen.

**Track:** A, Digital Fraud & Scam Resilience.

---

## Tools

| Job                   | Use                                                                         | Why                                                                                         |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Record                | **OBS Studio** (free), or **Cap** (cap.so, free, adds zoom automatically)   | Records at 1080p with no time limit. Loom's free plan caps length and quality.              |
| Edit                  | **Clipchamp** (built into Windows 11, free)                                 | Trim, zoom, text overlays, auto-captions, blur, and a voice-over track in one app.          |
| Voice                 | Any USB or earphone mic, in a quiet room with soft furnishings              | Bad audio hurts more than plain visuals.                                                     |
| Phone look            | Chrome DevTools, device toolbar (Ctrl+Shift+M), "Pixel 7" at 100%           | Shows the real mobile UI on the laptop screen.                                              |

OBS settings: canvas and output 1920×1080, 30 fps, MKV (remux to MP4 afterwards), mic on its own
track. Record **one segment per file** so a mistake costs one retake, not the whole video.

## The WhatsApp message (how to show it)

Use the chat mock that is already in the repository. **Don't use an AI-generated image as the
screenshot you upload.** Image models garble small text, so "INH000011431" or the UPI ID would come
out wrong. Jaanch would then read the wrong number, and the key verdict of the demo would break.

1. Open `demo/chat-mock.html#scam-en` in Chrome with the device toolbar set to Pixel 7. It looks
   like WhatsApp on a phone. Record it scrolling slowly. This is the hook shot.
2. Upload `demo/screenshots/scam-en.png`. It is the same chat, captured from that page.
3. Optional, for more polish: generate a phone mockup with Gemini (prompt below) that has a
   **plain green screen**. In Clipchamp, place `scam-en.png` over the green screen. That gives a
   realistic hand-held phone with the exact, correct text.

---

## Pre-flight (30 minutes before)

1. Wake the server: open `https://<api>/healthz` (free hosting sleeps after 15 minutes idle).
2. Check that the data is fresh: `GET /api/v1/sources` should show SEBI dates from today or
   yesterday. If not, run `POST /admin/ingest` and wait a minute.
3. Do a dry run of every segment. This also warms the models. Keep each report URL open in a
   spare tab as a backup.
4. Chrome: a fresh profile, bookmarks bar hidden, zoom 110–125%, only the demo tabs open. Turn on
   Windows Focus or Do Not Disturb, and hide the taskbar.
5. Tab order: ① chat mock (Pixel 7) · ② Jaanch home (Pixel 7) · ③ Jaanch home (desktop) · ④–⑥
   backup report URLs.

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
