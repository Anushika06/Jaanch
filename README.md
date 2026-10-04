# Jaanch · जाँच

**Forward it. Jaanch investigates it.**

Jaanch checks the claims in an investment message — a WhatsApp forward, a screenshot, a link, a
voice note — against India's official records before you send money. Every claim gets a verdict
backed by evidence you can open on the regulator's own website. In English and Hindi.

> Jaanch does not give investment advice, and never rates anything "safe" or "scam".

---

## The problem

Investment pitches borrow credibility: a **real SEBI registration number that belongs to someone
else**, "SEBI approved" tips, guaranteed returns, "institutional accounts", a personal UPI ID, an
APK link, "offer valid today only". Checking them needs knowledge of SEBI's registers and rules
that most retail investors don't have — and the check has to happen on WhatsApp, where the pitch
arrived.

## What Jaanch does

- Lists every claim in the message, word for word.
- Checks each against **SEBI's registers** (12 categories, refreshed daily and confirmed live),
  **SEBI's list of cancelled/suspended registrations**, **SEBI's rules** (cited to the circular and
  clause), **RBI's Alert List** and **domain records**.
- Decides each claim with fixed rules: **CONTRADICTED · MATCHES · NOT FOUND · CAN'T CHECK**.
- Shows _who is contacting you_ next to _who is registered_ — name, number, phone, email, website.
- Says plainly what it **could not check**.
- Routes people who **already paid** to 1930, cybercrime.gov.in, their bank and a UPI complaint,
  with a copyable evidence summary.

### The differentiator

> **"The registration number is real. It just isn't theirs."**
>
> _Message:_ "Sharma Investments — SEBI Registered Research Analyst — Reg No: INH000011431"
>
> **CONTRADICTED** — The message says INH000011431 belongs to Sharma Investments. SEBI's register
> shows INH000011431 is registered to 360 ONE Distribution Services Limited (Mumbai) — a
> different name.

Jaanch checks whether the _party contacting you_ is the _party the record belongs to_ — not only
whether a number exists.

## How it works

```mermaid
flowchart LR
  A[Message<br/>text · screenshot · voice · link] --> B[LLM reads<br/>verbatim transcript,<br/>claims as JSON]
  B --> C[Tools verify<br/>SEBI registers · inactive list<br/>RBI Alert List · RDAP · rule table]
  C --> D[Code adjudicates<br/>4 verdicts, deterministic]
  D --> E[LLM explains<br/>templates EN/HI ·<br/>guarded summary]
  E --> F[WhatsApp reply<br/>+ web report]
```

- The model only **reads**; every quote and identifier it returns must be found in the message
  or it is discarded. **It never decides a verdict.**
- Unclear screenshots and voice notes can never produce a CONTRADICTED verdict.
- Every factual sentence comes from a reviewed English/Hindi template with values inserted
  verbatim.

## Interfaces

| Channel                             | What it's for                                                                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WhatsApp** (Twilio sandbox today) | The primary channel: forward the pitch, get verdicts + next steps in ~30 s, `PAID` / `HINDI` / `DELETE` commands                                   |
| **Web**                             | Full evidence report, Hindi/English switch, screenshot upload, "I already paid" page, shareable link — and the fallback if WhatsApp is unavailable |

Both are thin adapters over the same engine; the web renders server-built views and contains no
investigation logic.

## Architecture

TypeScript monorepo, one deployable service:

```
packages/core      engine: schemas, extraction, claims, adjudication, rules, templates (EN/HI)
packages/db        Postgres (node-postgres in production, embedded PGlite in dev/tests), queue
packages/sources   SEBI registers (Excel export + live + inactive), RBI Alert List, RDAP
packages/llm       NVIDIA NIM reader/extractor/narrator, Riva speech-to-text, model probe
apps/server        Fastify API, Twilio WhatsApp channel, event-driven worker, CLI
apps/web           React web app
```

Details: [docs/architecture.md](docs/architecture.md) · decisions and trade-offs:
[docs/technical-decisions.md](docs/technical-decisions.md).

## Safety and privacy

- No overall score; no accusations ("the message says X, the record shows Y"); no advice.
- Screenshots and voice notes deleted right after reading; reports kept 7 days or deleted on
  request; no phone numbers or IPs stored (HMACs only); the requester's own number is redacted.
- Twilio signatures verified; uploads validated by content; links in messages are never opened.
- **Prototype caveat:** screenshots are read by NVIDIA's hosted API catalog, whose trial terms
  don't allow production use or personal data.

More: [docs/trust-and-safety.md](docs/trust-and-safety.md).

## Setup

Requirements: Node.js 22+, pnpm 10 (`corepack enable`). Optional: Docker, cloudflared.

```bash
pnpm install
cp .env.example .env     # add NVIDIA_API_KEY (and Twilio values for WhatsApp)
pnpm dev                 # API http://localhost:8787 · web http://localhost:5173
```

The first start creates an embedded database in `apps/server/.data` and downloads SEBI's
registers and RBI's Alert List (about a minute). No Postgres needed for development.

Useful commands:

```bash
pnpm --filter @jaanch/server cli investigate "SEBI RA INH000011431, guaranteed 30% monthly"
pnpm --filter @jaanch/server cli ingest all        # refresh official data now
pnpm --filter @jaanch/server cli status            # what's loaded, and how fresh
pnpm --filter @jaanch/llm probe                    # rank live NVIDIA models on our tasks
SOURCE_MODE=fixture pnpm dev                       # offline, FICTIONAL data (clearly labelled)
```

### Environment variables

The essentials (full list with comments in [.env.example](.env.example)):

| Variable                                                                                      | Purpose                                                  |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `NVIDIA_API_KEY`                                                                              | Reading screenshots, extracting claims, voice notes      |
| `DATABASE_URL`                                                                                | Postgres in production (empty = embedded database)       |
| `APP_SECRET`                                                                                  | Keys for hashing and encryption (required in production) |
| `PUBLIC_BASE_URL` / `WEB_BASE_URL`                                                            | Public URLs for webhook signatures and report links      |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_SANDBOX_JOIN_CODE` | WhatsApp channel                                         |
| `LLM_VISION_MODEL`, `LLM_TEXT_MODEL`                                                          | Override model choice (hosted models change often)       |

### WhatsApp (Twilio sandbox) locally

```bash
pnpm tunnel   # prints https://<random>.trycloudflare.com
```

Set `PUBLIC_BASE_URL` to that URL, restart, and in Twilio's sandbox settings set _When a message
comes in_ to `<tunnel>/webhooks/twilio/whatsapp` (POST). Join the sandbox from your phone and send
`HELP`. Step-by-step: [docs/deployment.md](docs/deployment.md#6-whatsapp-twilio-sandbox-and-webhook).

### Web

`pnpm dev:web` runs the Vite dev server (proxying `/api` to `:8787`). `pnpm build` builds the web
app into `apps/web/dist`, which the API server also serves.

## Deployment

Free tier: Render (Docker web service) + Neon (Postgres) + optional Vercel (web) + optional
GitHub Actions (daily data refresh). One-click blueprint in [render.yaml](render.yaml); the full
walkthrough, security checklist and troubleshooting are in [docs/deployment.md](docs/deployment.md).

## Testing

```bash
pnpm test         # unit + integration tests (core, db, sources, llm, server, web)
pnpm test:live    # live checks against SEBI, RBI and RDAP (network)
pnpm typecheck && pnpm lint
```

The suite covers the ten required scenarios (impersonation, legitimate entity, ambiguous sender,
missing registration number, OCR error, unavailable source, malicious links, suspicious UPI,
guaranteed returns, legitimate financial wording), prompt injection, webhook signatures and
idempotency, upload validation, English/Hindi parity and WhatsApp length limits. The database
suite also runs against a real Postgres (`JAANCH_TEST_DATABASE_URL`).

## Demo

A four-minute product demo script with dialogue, screen actions and backup paths:
[docs/demo-video-script.md](docs/demo-video-script.md). Demo screenshots (fictional senders) are in
[demo/screenshots](demo/screenshots).

## Documentation

| Document                                                                             |                                                     |
| ------------------------------------------------------------------------------------ | --------------------------------------------------- |
| [Product explainer](docs/product-explainer.md) ([HTML](docs/product-explainer.html)) | What Jaanch is and isn't                            |
| [Architecture](docs/architecture.md) ([HTML](docs/architecture.html))                | Components, pipeline, data, failure behaviour       |
| [User workflows](docs/user-workflow.md) ([HTML](docs/user-workflow.html))            | WhatsApp, web, "I already paid"                     |
| [Demo video script](docs/demo-video-script.md) ([HTML](docs/demo-video-script.html)) | Production script                                   |
| [Trust and safety](docs/trust-and-safety.md)                                         | AI safety, privacy, security, limitations           |
| [Technical decisions](docs/technical-decisions.md)                                   | Alternatives and reasons                            |
| [Deployment](docs/deployment.md)                                                     | Free-tier deployment, Twilio setup, troubleshooting |

## Roadmap

- Production WhatsApp sender and a model provider with production data terms (self-hosted NIM).
- NSE/BSE caution notices and SEBI's unregistered-entity orders as sources.
- AMFI mutual-fund distributor (ARN) verification; exchange Authorised Person lookups.
- More Indian languages, with hand-reviewed templates per language.
- Voice replies for low-literacy users, generated from the same templates.
- Anonymous, aggregate signals (e.g. which registration numbers are being impersonated) shared
  with regulators — without personal data.

## Contributors

- **Dhruv Sharma** — [github.com/spiritsfuse](https://github.com/spiritsfuse) · product direction and the brief that shaped Jaanch
- **Anushika Chauhan** — [github.com/anushika06](https://github.com/anushika06)
- **Pratyush Mishra** — [github.com/PratyushMishra-2nd](https://github.com/PratyushMishra-2nd)
