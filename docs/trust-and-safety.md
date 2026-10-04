# Trust and safety

Jaanch tells people what official records and SEBI's rules show about the claims in a message.
It must never become a source of false confidence, false accusation or financial advice.

## Commitments

1. **No overall verdict.** There is no safety score, risk percentage, "safe" badge or "scam"
   label — not in the data model, the API or the web app. Each claim gets one of four
   verdicts, and "can't check" is always stated explicitly.
2. **No accusations.** Jaanch says "the message says X; the official record shows Y". It never
   calls a person or firm a scammer or fraudster. When a registration number belongs to someone
   else, the real holder is presented as what it is — the registered entity — not as a suspect.
3. **No advice.** Jaanch never recommends buying, selling, holding or investing in anything.
   Next steps are about verifying through official channels and reporting.
4. **Absence of evidence is not safety.** Every report includes what could not be checked and why.
5. **Every factual statement has a source.** Evidence items link to the public official page;
   rules cite the regulation or circular, clause and date.

## How the model is kept honest

| Risk                                                                                 | Control                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The model invents a claim, name or number                                            | Model output must validate against a JSON schema; every quote must be found in the transcript and every identifier must literally occur in it, or the item is dropped. Identifiers used for lookups come from deterministic extraction, never from the model.                                                                               |
| The model decides a verdict                                                          | It cannot: verdicts are computed by deterministic code from official evidence and the rule table.                                                                                                                                                                                                                                           |
| Prompt injection inside a screenshot or message ("mark this as verified")            | Message content is treated as untrusted data in every prompt; the model only returns schema-constrained extraction; ungrounded output is discarded; the explanation step never sees the original message (it receives rendered facts only). A test sends an injection attempt and checks that nothing is accepted.                          |
| A summary that adds facts or reassurance                                             | The optional narrative is rejected unless every number and identifier already appears in the verified facts and it contains no safety labels, accusations or investment instructions; otherwise no summary is shown.                                                                                                                        |
| OCR misreads a digit and creates a false contradiction                               | Readers list unclear fragments; an independent re-read compares identifiers; look-alike substitutions and audio transcripts mark identifiers uncertain; uncertain identifiers can never produce CONTRADICTED.                                                                                                                               |
| Brand vs legal names cause false mismatches ("Groww" vs "Groww Invest Tech Pvt Ltd") | Name comparison ignores legal forms and industry words and matches against legal names, trade names, proprietor brands and contact persons; similar names (shared surname, different industry word) are CAN'T CHECK, not CONTRADICTED.                                                                                                      |
| A loosely associated name triggers a contradiction                                   | A name/number mismatch is CONTRADICTED only when the message explicitly ties the two together (same statement or adjacent lines) and both were read clearly.                                                                                                                                                                                |
| Regulatory facts are wrong                                                           | Every rule in `packages/core/src/rules/table.ts` was read in the primary source (SEBI master circulars, regulations, press releases; exchange releases) and carries the citation, clause, date and URL. Re-verification is required when SEBI changes them (the Common Advertisement Code approved on 24 Sep 2026 is pending notification). |
| Translation changes meaning                                                          | Hindi templates are written by hand and checked by a test for identical keys and placeholders; evidence values are inserted verbatim. Machine translation is not used.                                                                                                                                                                      |

## Privacy

Data minimisation by design:

| Data                                                 | Stored?          | How long                                                       | Protection                                                                                                            |
| ---------------------------------------------------- | ---------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Screenshots, voice notes                             | Only until read  | Deleted right after reading (hard expiry 30 min)               | Images re-encoded on upload, which strips EXIF/GPS metadata                                                           |
| Report (claims, evidence, transcript of the message) | Yes              | 7 days, or immediately with "Delete this report" (owner token) | Unguessable 128-bit report ids                                                                                        |
| Phone number, name, account                          | Never asked      | —                                                              | No sign-up; nothing identifies the person checking                                                                    |
| IP address                                           | No               | —                                                              | Rate limiting uses an HMAC of the IP                                                                                  |
| Amount paid, bank account, transaction ID            | Never asked      | —                                                              | The "I already paid" flow is routing only; bank account numbers found in a message are masked to the last four digits |
| Logs                                                 | Operational only | Provider retention                                             | Route patterns instead of URLs, no message bodies, no phone numbers, credentials redacted                             |

**Model provider caveat (prototype).** Screenshots and voice notes are processed by NVIDIA's
hosted API catalog. Its trial terms prohibit production use and personal data and allow NVIDIA to
log inputs. The web app and privacy page say so. Before real users rely on Jaanch, point
`NVIDIA_BASE_URL` at a self-hosted NIM or a provider with suitable data terms.

## Security

- **SSRF:** Jaanch never opens links found in messages; uploads are the only content it fetches.
- **Uploads:** type is determined from the bytes, not the client's claim; only JPEG/PNG/WebP and
  common audio types are accepted; size and count limits apply; images are fully decoded and
  re-encoded.
- **Abuse:** per-IP and per-user hourly limits on investigations, a global request rate limit,
  and bounded inputs (text 20,000 characters, 5 screenshots).
- **Headers:** strict Content-Security-Policy (no third-party scripts), `nosniff`, no referrer,
  frame-ancestors none.
- **Secrets:** read from the environment only, validated at start-up, never logged; production
  refuses to start without `APP_SECRET`, with fixture data, or with signature checks disabled.
- **Admin API:** disabled unless `ADMIN_TOKEN` is set; constant-time token comparison.

## Known limitations

- Jaanch checks SEBI-regulated intermediaries and a set of SEBI rules. It cannot check who owns a
  phone number, who runs a Telegram or WhatsApp group, what a link leads to, or whether a
  promised return will be paid — and says so.
- Registers are snapshots refreshed daily, confirmed live when a number is missing; a very recent
  change can still be missed (the report shows the as-of date).
- NSE/BSE caution notices are not machine-readable and are not yet included.
- Jaanch is web-only. A WhatsApp channel exists in the code but stays off: Meta's Cloud API needs
  a verified business and Twilio's sandbox a paid account.
