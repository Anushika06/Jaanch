# Technical decisions

Each entry states the decision, the alternatives we weighed, and why. They describe the system as
built; when a decision changes, update the entry rather than adding a contradicting one.

---

## 1. WhatsApp first, web as a second channel over the same engine

**Decision.** WhatsApp is the primary channel; a web app is a second channel. Both are thin
adapters over one investigation engine (`packages/core`), and both render the same structured
report.

**Alternatives.**

- _WhatsApp only._ Matches where scam pitches arrive and where users already are, but a 1,600
  character message cannot carry evidence tables, source links and rule citations. It also has
  no fallback when the WhatsApp provider is down, and is hard to demo or debug.
- _Web only._ Rich, but asks a Tier-2/3 user to leave WhatsApp, copy text and find a website:
  the friction kills the habit we want ("forward it, Jaanch checks it").
- _Two separate products._ Duplicated logic would drift; a contradiction on one channel and not
  the other would destroy trust.

**Why.** The WhatsApp reply carries the verdicts, top warnings and next steps; the web report is
the full evidence (claim-by-claim, binding table, citations, sources) and the WhatsApp reply links
to it. The web app is also the fallback channel, the debugging surface and the demo surface. No
investigation logic lives in the web app: it renders a view model produced server-side by
`buildReportView`, the same templates WhatsApp uses.

## 2. Twilio WhatsApp Sandbox now, provider-independent channel layer

**Decision.** Use Twilio's WhatsApp Sandbox for the prototype behind a `MessagingTransport`
interface (`apps/server/src/channels/whatsapp/transport.ts`). Conversation logic depends only on
that interface.

**Alternatives.** Meta's WhatsApp Cloud API test number (free, production-identical API, but
limited to pre-registered recipient numbers, so judges and testers cannot simply join; tokens
expire quickly); a dedicated WhatsApp Business number (weeks of Meta business verification).

**Why.** Anyone can join the sandbox by sending a join code, which suits demos and testing.
Moving to a production sender is configuration (`TWILIO_WHATSAPP_FROM` or
`TWILIO_MESSAGING_SERVICE_SID`) — webhook format, signatures and media handling are unchanged. A
Meta Cloud API transport can be added by implementing the same interface.

**Sandbox limits we designed around:** sessions expire 3 days after joining (users re-send the
join code); 1 outbound message per 3 seconds (a single paced send queue); trial accounts get 50
messages/day; free-form replies only within 24 hours of the user's last message (we only ever
reply). In Twilio's newer console, trial accounts may only see "Try out WhatsApp" (template-only);
the sandbox lives in the legacy console and may require an upgraded account — see
[deployment.md](deployment.md).

## 3. A modular monolith, not microservices

**Decision.** One deployable Node.js service (API + WhatsApp webhook + worker + optional static
web app), built from a TypeScript monorepo with strict package boundaries:

| Package           | Responsibility                                                                                                                                                        | Depends on                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `@jaanch/core`    | Schemas, deterministic extraction, claim building, verification planning, adjudication, rule table, templates (EN/HI), report/view/WhatsApp/summary rendering, engine | zod, tldts, libphonenumber-js |
| `@jaanch/db`      | Postgres access (pg or embedded PGlite), migrations, repositories, queue                                                                                              | core                          |
| `@jaanch/sources` | SEBI registers, RBI Alert List, RDAP adapters + ingestion                                                                                                             | core, db                      |
| `@jaanch/llm`     | NVIDIA NIM reader/extractor/narrator, Riva ASR                                                                                                                        | core                          |
| `@jaanch/server`  | Config, HTTP, channels, worker, CLI — the composition root                                                                                                            | all                           |
| `@jaanch/web`     | React app (types only from core)                                                                                                                                      | —                             |

**Why.** The workload is small and bursty; a single service is cheapest to run (free tiers),
simplest to operate, and the package boundaries keep a later split (e.g. a separate worker) a
deployment change rather than a rewrite. `core` has no I/O: the engine takes its sources, model
and storage as injected ports, which is also what makes it testable with fixtures.

## 4. Asynchronous investigations on a Postgres-backed, event-driven queue

**Decision.** Investigations run asynchronously. Jobs live in a `jobs` table, are claimed with
`FOR UPDATE SKIP LOCKED`, carry a lease for crash recovery and retry with backoff. The in-process
worker is **event-driven**: it wakes when a job is enqueued or a scheduled job falls due, and makes
no queries while idle (`WORKER_POLL_MS=0`).

**Alternatives.** Synchronous request handling (Twilio's webhook times out at 15 s; an
investigation takes 10–60 s); Redis + BullMQ (another service to run and pay for); a polling
worker (keeps a serverless database awake — on Neon's free plan, polling around the clock would
exhaust the monthly compute allowance mid-month).

**Why.** Durable, multi-worker-safe, zero extra infrastructure, and friendly to scale-to-zero
databases. The same table drives WhatsApp debouncing (several screenshots sent in a burst become
one investigation) and paced outbound sending.

## 5. PostgreSQL everywhere; embedded Postgres (PGlite) for development and tests

**Decision.** Production uses PostgreSQL (Neon recommended). Without `DATABASE_URL`, the server
uses PGlite — real Postgres compiled to WebAssembly — so development and tests need no setup and
run the _same SQL and migrations_. Migrations are hand-written SQL, applied in order and recorded.

**Alternatives.** SQLite for development (a second SQL dialect to keep in sync); an ORM (adds a
layer without solving anything we need — the queries are few and explicit).

**Verified.** The full repository test suite runs on both PGlite and a real Postgres 17 instance.

## 6. No object storage: media is ephemeral

**Decision.** Uploaded screenshots and voice notes are stored as `bytea` with a 30-minute expiry,
read once by the reader, and deleted immediately afterwards (whatever the outcome). Inbound
WhatsApp media is also deleted from Twilio after download (`TWILIO_DELETE_INBOUND_MEDIA=true`).

**Why.** Privacy by design: there is no reason to keep a person's screenshots. Object storage would
add a service and a retention problem for data we do not want.

## 7. Reading screenshots with a vision model, with uncertainty made explicit

**Decision.** A vision-language model transcribes screenshots verbatim and must list hard-to-read
fragments. A second, independent read of only the critical identifiers (registration numbers,
UPI IDs, phones) is compared with the first; any disagreement marks the identifier _uncertain_.
Identifiers read with OCR look-alike substitutions (O→0, I→1) are also uncertain. Uncertain
values can never ground a CONTRADICTED verdict.

**Alternatives.** Tesseract (weak on Hindi and on chat-UI screenshots); cloud OCR APIs (another
vendor, still no semantic understanding).

**Why.** Modern VLMs read mixed Hindi/English chat screenshots well; the consensus read and the
uncertainty rule turn the model's weakest failure (a confidently wrong digit) into "can't check"
instead of a false accusation. Tall screenshots are split into overlapping greyscale tiles to fit
NVIDIA's inline image budget without shrinking text below legibility.

## 8. Language model provider: NVIDIA NIM, behind an OpenAI-compatible adapter

**Decision.** NVIDIA's hosted API catalog (OpenAI-compatible Chat Completions) is the reading and
extraction provider; speech-to-text uses NVIDIA's hosted Riva ASR (Whisper large-v3, Hindi
supported) over gRPC. Model IDs are configuration (`LLM_VISION_MODEL`, `LLM_TEXT_MODEL`,
`LLM_NARRATOR_MODEL`, `LLM_ASR_MODEL`), checked at start-up, and chosen by a live probe
(`pnpm --filter @jaanch/llm probe`).

**Constraints found during research (2026-10-04).**

- Hosted models are retired often (HTTP 410 with an end-of-life date); several commonly cited IDs
  (Llama 4 Maverick, Llama 3.3 70B, Phi-4 multimodal) are already retired. The provisional
  default (`google/gemma-4-31b-it`) was chosen from live models with documented Hindi support;
  the live probe confirms or replaces it once an API key is configured.
- JSON constraints vary by model and unsupported fields may be ignored silently. The client tries
  `response_format: json_schema`, then `guided_json`, then `nvext.guided_json`, then plain
  prompting; it learns per model which mode produced _valid_ output; every result is validated
  with zod and gets at most one repair round.
- NVCF may answer 202 with `NVCF-REQID`; the client polls `/status/{id}`.
- **The free API catalog's trial terms prohibit production use and personal data, and allow
  NVIDIA to log inputs.** It is appropriate for this prototype with synthetic or redacted
  screenshots only. For real users, point `NVIDIA_BASE_URL` at a self-hosted NIM or a partner
  endpoint with appropriate terms, or add another provider adapter — the engine is unaffected.

## 9. Structured extraction, grounded; models never decide

**Decision.** `LLM READS → TOOLS VERIFY → CODE ADJUDICATES → LLM EXPLAINS`.

1. The model returns JSON validated against `ModelExtraction`.
2. Every quote must be found in the transcript (`locateQuote`), every identifier must literally
   occur in it; otherwise the item is dropped.
3. Identifiers always come from deterministic extraction (exact strings), never from the model.
4. Deterministic patterns (EN/HI/Hinglish) run on every transcript; they keep Jaanch useful when
   the model is unavailable and are merged with model output.
5. Verdicts are computed by pure functions (`packages/core/src/adjudicate`) from claims, retrieved
   evidence and the rule table.
6. The optional narrative is written from rendered facts only — never from the message — and is
   rejected unless every number and identifier already appears in the facts and it contains no
   safety label, accusation or investment instruction.

## 10. Four verdicts, defined precisely

| Verdict      | Meaning                                                                                              | Can be produced by                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| CONTRADICTED | An official record or a cited rule positively shows something different from what the message claims | Registry records, inactive-registration list, rule table — only from clearly read inputs |
| MATCHES      | An official record positively confirms the claim as the message states it                            | Registry records, contact comparison                                                     |
| NOT FOUND    | The source that should contain it was searched and has no such record                                | Registry snapshot/live search                                                            |
| CAN'T CHECK  | No source, source unavailable, unclear input, ambiguous binding, or a claim about the future         | Everything else                                                                          |

There is no overall score, rating, or "safe/scam" label anywhere — in the data model, the API or
the UI. Headlines summarise claim verdicts with fixed precedence.

**Channel binding.** A registration claim is checked as "does the party contacting you correspond
to the record?", not merely "does the number exist?". A real number under a different name is
CONTRADICTED only when the message explicitly ties the two together, both were read clearly, and
no official name variant matches (legal name, trade name, proprietor brand, contact person).
Similar names (shared surname, different industry word) are CAN'T CHECK. Contact channels in the
message (phone, email domain, website) are compared with the record and look-alike domains flagged.

## 11. Official data: snapshots plus live confirmation

**Decision.** SEBI's registers are ingested from SEBI's own per-category Excel export (12
categories, ~11,500 merged records, ~1 minute) into Postgres. A lookup answers from the snapshot;
a miss is confirmed against SEBI's live search, and if still missing, SEBI's list of cancelled,
surrendered, expired and suspended registrations is checked. Live answers are cached for 6 hours.
The RBI Alert List is ingested from its HTML table. RDAP (the IETF successor to WHOIS) supplies
domain registration dates, cached for 7 days.

**Freshness.** Every evidence item and source run carries the date the source declares itself
current to ("as on"), when Jaanch retrieved it, and whether it is stale (SEBI snapshot older than
72 h; RBI list older than 14 days) or fixture data. Snapshots refresh on boot when older than 24 h, and optionally daily via GitHub
Actions.

**Not used:** NSE/BSE caution notices (published as PDFs/press releases without a machine-readable
list; scraping NSE is actively blocked), SEBI Check (captcha-protected web form — we link users to
it instead), AMFI's undocumented API, general web search (not authoritative).

## 12. Explanations from templates, in English and Hindi

**Decision.** Every user-facing sentence about evidence is a template keyed by a reason code, with
English and Hindi versions written by hand. Values (names, numbers, dates, quotes) are inserted
verbatim, so translation can never change a fact. The type system and a test enforce that both
languages have every key and the same placeholders. WhatsApp and web render from the same
catalog.

**Alternative rejected.** Machine-translating model output at request time — fluent but
unverifiable, and it can change meaning.

## 13. Free-tier hosting topology

**Decision.** Render (free web service, Docker, Singapore) runs the server; Neon (free Postgres,
Singapore) stores data; Vercel (Hobby) or the same Render service serves the web app; GitHub
Actions optionally refreshes official data daily. See [deployment.md](deployment.md).

**Risks and mitigations.**

- _Cold starts (~1 min on Render free) vs Twilio's 15 s webhook timeout._ The webhook does
  minimal work; on every boot the server lists recent inbound messages from Twilio's API and
  processes any it missed (idempotent by message id), so a cold start delays a reply instead of
  losing it.
- _Neon compute allowance._ Event-driven worker; health checks never touch the database.
- _512 MB memory._ Lazy-loaded embedded database, dense Excel parsing; ingestion can run in
  GitHub Actions instead of the web service.

## 14. Fixtures are labelled and cannot reach production

**Decision.** Development fixtures (fictional registry records, one fictional alert-list entry)
live in `packages/sources/src/fixtures.ts`, are loaded only with `SOURCE_MODE=fixture`, are marked
`isFixture` in every snapshot, evidence item and report, and are shown with a "DEVELOPMENT DATA"
banner. The server refuses to start with `SOURCE_MODE=fixture` when `NODE_ENV=production`.
Parser tests use responses captured from the real official pages (documented in
`packages/sources/test/fixtures/README.md`).
