# Jaanch — forward it, Jaanch investigates it

**Jaanch** (जाँच, "inspection") checks the claims in an investment message against India's
official records before you send money.

## The problem

Retail investors receive investment pitches on WhatsApp, Telegram, SMS and social media. The
convincing ones borrow credibility:

- a **real SEBI registration number** — that belongs to someone else;
- "SEBI approved" tips, "NSE partner" apps;
- **guaranteed** daily or monthly returns;
- "institutional accounts", "FPI accounts", "sure-shot IPO allotment";
- payment to a personal UPI ID, an app to install from a link, a deadline of "today only".

The investor's real question is simple: _"Before I pay, are the claims in this message backed by
evidence?"_ Checking that today means knowing which SEBI register to search, how registration
numbers work, what SEBI's rules say about returns and payments — in English, on a website.

## What Jaanch does

Forward the message (or a screenshot, link or voice note) to Jaanch on WhatsApp, or paste it on
the web. In about 30 seconds Jaanch returns a report:

- **Every claim, one by one**, with a stamp: **CONTRADICTED**, **MATCHES**, **NOT FOUND** or
  **CAN'T CHECK**.
- **The evidence** behind each one: the SEBI register entry (name, number, validity, official
  email/phone, address), the SEBI rule with its circular and clause, the RBI Alert List entry, the
  domain's registration date — each with a link to the official page and an "as of" date.
- **Who is contacting you vs who is registered**: a side-by-side table of the message's name,
  number, phone, email and website against the official record.
- **Warning signs**: pressure tactics, OTP requests, APK links, look-alike websites, personal UPI
  IDs, accuracy claims — each explained in plain words.
- **What could not be checked** — always listed, because no problem found is not proof of safety.
- **What to do next**: confirm through the official contact on SEBI's record (not the numbers in
  the message), check the UPI ID on SEBI Check, report the message on Sanchar Saathi (Chakshu).
- **"I already paid"**: 1930, cybercrime.gov.in, your bank, a UPI fraud complaint, what to keep —
  and a copyable evidence summary for your complaint. Jaanch never asks for your bank details.

Everything is available in **English and Hindi**.

## The differentiator: "The registration number is real. It just isn't theirs."

Most scam checks ask whether a number is valid. Jaanch asks whether **the party contacting you
is the party the number belongs to**.

> _Message (fictional sender):_ "Sharma Investments / SEBI Registered Research Analyst / Reg No:
> INH000011431 / 🔥 Guaranteed 30% monthly returns in F&O 🔥 / Pay ₹4,999 joining fee to UPI:
> 9876501234@ybl"
>
> **CONTRADICTED** — The message says INH000011431 belongs to Sharma Investments. SEBI's register
> shows INH000011431 is registered to 360 ONE Distribution Services Limited (Mumbai) — a different
> name.
>
> **NOT FOUND** — We found no SEBI-registered intermediary named Sharma Investments (register
> updated 3 Oct 2026).
>
> **CONTRADICTED** — The message claims SEBI registration (Research Analyst) and also promises
> guaranteed returns. SEBI's rules do not allow registered advisers, analysts or brokers to promise
> assured returns. _(SEBI Master Circular for Research Analysts, 6 Feb 2026, para 11.1(c)(x))_
>
> **CONTRADICTED** — The message asks for payment to 9876501234@ybl for a SEBI-registered service
> (Research Analyst). SEBI requires registered intermediaries to collect UPI payments through
> validated UPI IDs ending in "@valid…", and their old UPI IDs were to be discontinued.
> 9876501234@ybl is not such an ID. _(SEBI circular SEBI/HO/DEPA-II/DEPA-II_SRG/P/CIR/2025/86,
> 11 Jun 2025)_

This is the engine's output against SEBI's live register on 4 Oct 2026, with the claim extraction
supplied in the shape the model returns. The registered firm has nothing to do with the message —
its number was borrowed. Jaanch reports exactly that: what the record shows, without accusing
anyone.

## What Jaanch is not

- Not investment advice; it never says buy, sell, hold or invest.
- Not a "safe/scam" score; there is no overall rating.
- Not a judgement about any person or firm; it reports what official records show.
- Not a chatbot; it investigates the claims in what you send.

## How it decides

```
LLM READS  →  TOOLS VERIFY  →  CODE ADJUDICATES  →  LLM EXPLAINS
```

An AI model reads the screenshot and lists the claims word for word. Jaanch then looks them up in
SEBI's registers, RBI's Alert List, domain records and a table of SEBI rules, and fixed rules —
not the AI — decide each verdict. Explanations come from reviewed templates in English and Hindi.
If anything was unclear in the screenshot, Jaanch says it can't check rather than guessing.

## Built for Bharat

- **WhatsApp first** — the place the pitch arrived; no app to install.
- **Hindi and English**, including Hinglish and Devanagari screenshots; switch with "HINDI".
- **Voice notes** (speech-to-text) when supported by the configured provider.
- **Light web app** for slow connections; screenshots are compressed in the browser; installable,
  and on Android other apps can share text or links straight to Jaanch.
- **Plain language**: no jargon, short sentences, large tap targets.

## Privacy in one paragraph

Screenshots and voice notes are deleted as soon as they are read. Reports are kept for 7 days so
the link works, then deleted — or immediately on request ("DELETE" on WhatsApp, a button on the
web). Phone numbers and IP addresses are never stored; your own number is removed from forwarded
screenshots before checking. In this prototype, an NVIDIA-hosted AI model reads screenshots; its
terms allow logging, so avoid sending images with your own bank or personal details. Details:
[trust-and-safety.md](trust-and-safety.md).

## Sources

| Source                                                                                                                                                                                                       | Used for                                                                                     | Freshness                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| SEBI registers of intermediaries (12 categories: research analysts, investment advisers, stock brokers, portfolio managers, mutual funds, merchant bankers, AIFs, DPs, RTAs, debenture trustees, KRAs, CRAs) | Registration and identity checks                                                             | Daily snapshot from SEBI's export + live confirmation |
| SEBI list of cancelled, surrendered, expired and suspended registrations                                                                                                                                     | "Was registered, isn't now"                                                                  | Live                                                  |
| SEBI regulations, master circulars and press releases                                                                                                                                                        | Rule table (assured returns, @valid UPI, display of registration, OTPs, FPI route, cautions) | Verified 4 Oct 2026                                   |
| RBI Alert List of unauthorised forex platforms                                                                                                                                                               | Forex platform names and domains                                                             | Snapshot                                              |
| RDAP (domain registries)                                                                                                                                                                                     | Website age                                                                                  | Live, cached 7 days                                   |
