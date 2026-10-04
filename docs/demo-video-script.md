# Demo video — production script (4:00)

A product demo, not a slide talk: the viewer watches a person use Jaanch on a real phone and a
real browser, against live official data. Technical points come up only where the screen shows
them.

**Cast.** _Narrator_ (voice-over, calm, plain English with a few Hindi phrases). _Riya_ — the
person using the phone (hands only, or a face cam in the corner).

**Screens.** Phone screen recording (WhatsApp) mirrored to the laptop; browser at
`https://<your-domain>`; one architecture diagram (from [architecture.md](architecture.md)).

**Assets** (in the repository):

- `demo/screenshots/scam-en.png` — the "Sharma Investments" pitch (English)
- `demo/screenshots/scam-hi.png` — the same pitch in Hindi
- `demo/screenshots/institutional.png` — an "institutional account / FPI / APK" pitch
- The "SIP reminder" sample on the web home page; optionally a genuine message the team received
  from its own broker or mutual fund.

> **About the registration number in the demo screenshots.** `INH000011431` is a real, current
> SEBI registration (it belongs to 360 ONE Distribution Services Limited). It is used to show how
> impersonators borrow real numbers; the registered firm has no connection to these fictional
> messages. Say this on screen at 0:55. To use a different number, edit
> `demo/chat-mock.html` and re-capture the screenshots.

---

## Pre-flight (30 minutes before recording)

1. **WhatsApp:** the demo phone must be registered as a tester in the Meta app (WhatsApp → API
   Setup → To). Send `HELP` and confirm a reply arrives — this also opens the 24-hour reply window.
   If the access token is a temporary one, generate a fresh token first (they expire within a day).
2. **Warm the server:** open `https://<api>/healthz` (free hosting sleeps after 15 minutes idle).
3. **Fresh data:** `GET /api/v1/sources` — SEBI categories should show today's or yesterday's date.
   If not: `POST /admin/ingest` with the admin token, wait a minute.
4. **Dry run** every segment once (this also warms caches). Note each report URL as a backup.
5. Phone: Do Not Disturb on, battery > 50%, font size default, dark mode off (for contrast).
6. Browser: zoom 125%, one tab, bookmarks bar hidden, language set to English.

---

## 0:00 – 0:20 · Hook

|                          |                                                                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Screen**               | Black. Then the phone: a WhatsApp chat from "Sharma Investments ✅" scrolling slowly — "SEBI Registered Research Analyst… Reg No: INH000011431… Guaranteed 30% monthly returns… Pay ₹4,999…". |
| **Narrator**             | "Last week, Riya got this message. It has a SEBI registration number. She checked — the number is real." _(beat)_ "It just isn't theirs."                                                     |
| **On screen text**       | Large, centred over a dimmed chat: **The registration number is real. It just isn't theirs.**                                                                                                 |
| **Transition**           | Cut to the phone, Riya long-presses the screenshot.                                                                                                                                           |
| **Viewer should notice** | The pitch looks credible precisely because one part of it is true.                                                                                                                            |

## 0:20 – 1:35 · Live investigation on WhatsApp

| Time | Screen action                                                                                                                                                                                                                                                                  | Narrator                                                                                                                                                                                                       | Notice                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 0:20 | Riya forwards the screenshot to the chat named **Jaanch**.                                                                                                                                                                                                                     | "Riya does what she does with everything on WhatsApp: she forwards it — to Jaanch."                                                                                                                            | No app, no website.                                               |
| 0:28 | Jaanch replies instantly: "Got it. Send any more screenshots now — I will start checking in a few seconds." Riya waits.                                                                                                                                                        | "Jaanch reads the screenshot, lists every claim in it, and checks each one against official records."                                                                                                          | The acknowledgement is immediate.                                 |
| 0:45 | The report arrives. Hold on the headline. Zoom on the first entry: ❌ **CONTRADICTED** — "The message says INH000011431 belongs to Sharma Investments. SEBI's register shows INH000011431 is registered to 360 ONE Distribution Services Limited (Mumbai) — a different name." | "First claim: the registration. The number exists — in SEBI's register it belongs to a different firm. That firm has nothing to do with this message; its number was borrowed."                                | The wording reports the record; nobody is called a scammer.       |
| 1:00 | Scroll: 🔍 NOT FOUND (no registered firm named Sharma Investments), ❌ guaranteed returns, ❌ UPI ID; warnings (guaranteed returns, 100% accuracy claim, personal UPI ID).                                                                                                     | "Second: guaranteed 30% a month. SEBI's rules don't allow registered analysts to promise that. Third: SEBI-registered firms must collect money through verified '@valid' UPI IDs — this one is a personal ID." | Each line cites a rule, not an opinion.                           |
| 1:12 | Scroll to _Could not check_ and _What to do next_.                                                                                                                                                                                                                             | "And Jaanch is honest about what it can't check — who runs that Telegram group, or whether any return will ever be paid. Not finding a problem is never shown as safety."                                      | There is no overall "safe" or "scam" score anywhere.              |
| 1:20 | Tap the report link → browser opens the full report. Tap **Show evidence** under the first claim: the SEBI register entry with name, number, validity, official email and phone, "Open the official source". Scroll to **Who is contacting you, and who is registered**.       | "Every verdict has evidence you can open on SEBI's own website. And this table is the heart of it: who is contacting you, versus who is registered. Same registration number — different name."                | The channel-binding table: Name _Different_, Registration _Same_. |

**Backup path:** if the WhatsApp reply doesn't arrive within 60 seconds (a cold start or a slow
model response), cut to the pre-recorded dry-run clip of the same exchange, then continue live in the
browser with the dry-run report URL.

## 1:35 – 2:10 · A legitimate message

|              |                                                                                                                                                                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Screen**   | Browser home. Click the sample **SIP reminder** ("Your SIP of Rs 5,000 in XYZ Flexi Cap Fund will be debited… subject to market risks"). Click **Investigate**. Report: "We didn't find investment claims to check in this message." No warnings.                                                      |
| **Narrator** | "Does Jaanch flag everything that mentions money? No. A normal SIP reminder — with the usual market-risk disclaimer — raises nothing."                                                                                                                                                                 |
| **Then**     | _(Optional, if the team has one)_ paste a genuine message from your own broker or fund house that shows its registered name, number and official email. Report: ✅ **MATCHES** — "SEBI's register lists … The name in the message matches", and the contact table shows **Same domain** for the email. |
| **Narrator** | "And when a firm uses its own registered name, number and official contacts, the record matches — while Jaanch still reminds you that details can be copied."                                                                                                                                          |
| **Notice**   | MATCHES is evidence-based, never "safe".                                                                                                                                                                                                                                                               |
| **Backup**   | If the network is slow, show the dry-run report tab.                                                                                                                                                                                                                                                   |

## 2:10 – 2:40 · "I already paid"

|              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Screen**   | Back on the phone. Riya types **PAID**. Reply: numbered steps — call 1930, cybercrime.gov.in, tell the bank, UPI fraud complaint, keep evidence, beware of "recovery" offers — and a link. Tap the link: the web recovery page with a large **Call 1930** button and the evidence summary. Tap **Copy evidence summary**; paste it into a notes app to show the text: report id, time, each claim with what SEBI's record showed, the UPI ID and phone from the message. |
| **Narrator** | "If Riya had already paid, every minute matters. Jaanch doesn't ask for her bank details — it tells her exactly where to go, and hands her an evidence summary to attach to the complaint."                                                                                                                                                                                                                                                                              |
| **Notice**   | Routing only, nothing collected; the summary is ready to paste into 1930 / cybercrime.gov.in.                                                                                                                                                                                                                                                                                                                                                                            |

## 2:40 – 3:15 · Same engine, on the web, in Hindi

|              |                                                                                                                                                                                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Screen**   | Browser home → switch to **हिंदी**. Upload `demo/screenshots/scam-hi.png`. Progress list animates: "मैसेज पढ़ा जा रहा है… आधिकारिक रिकॉर्ड जाँचे जा रहे हैं…". Report headline: **रजिस्ट्रेशन नंबर असली है। बस वह उनका नहीं है।** Stamps: रिकॉर्ड से उलट.                                |
| **Narrator** | "The same investigation engine powers the web. Here's the Hindi version of the pitch — 'रोज़ 5% पक्का मुनाफ़ा' — and the report comes back in Hindi, with the same evidence. The numbers and names are inserted exactly; only the explanation is translated, by hand-written templates." |
| **Notice**   | Identical verdicts across channels and languages.                                                                                                                                                                                                                                        |
| **Backup**   | If screenshot reading is unavailable, paste the Hindi text instead (same result while the text model is available).                                                                                                                                                                      |

## 3:15 – 3:45 · How it decides, and why you can trust it

|              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Screen**   | One diagram: **LLM reads → tools verify → code adjudicates → LLM explains**, with icons for SEBI registers, RBI Alert List, SEBI rules, and a lock for privacy.                                                                                                                                                                                                                                                                                                                                                           |
| **Narrator** | "An AI model only reads the message and lists its claims — word for word, and anything it can't point to in the message is thrown away. Official sources do the verifying: SEBI's registers, refreshed daily and confirmed live, its list of cancelled registrations, RBI's alert list, and SEBI's own rules with their circular numbers. Fixed code — not the AI — decides each verdict. If a screenshot is blurry, Jaanch says 'can't check' instead of guessing. And screenshots are deleted the moment they're read." |
| **Notice**   | Determinism and provenance, in one sentence each.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## 3:45 – 4:00 · Impact

|               |                                                                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Screen**    | The WhatsApp chat again, then the Jaanch home page.                                                                                                                                |
| **Narrator**  | "Every investor in India already has WhatsApp. Jaanch meets them there — in Hindi or English — with official evidence before the money moves. Forward it. Jaanch investigates it." |
| **On screen** | **Jaanch — forward it, Jaanch investigates it.** Contributors: Dhruv Sharma · Anushika Chauhan · Pratyush Mishra                                                                   |

---

## Recording notes

- Keep the cursor still while the narrator reads a verdict; zoom (not pan) into text.
- Show real wait times once (the first WhatsApp reply); trim later waits to 2–3 seconds.
- Never show a real person's phone number or chats other than the demo chat.
- The impersonation report's next steps show the contact email from SEBI's public record for the
  real registration holder (an individual's work address). Blur it in the edit.
- Subtitles in English; Hindi segment subtitled in both.
- Export 1080p, 30 fps; audio −16 LUFS.
