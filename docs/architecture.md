# Architecture

Jaanch is a website in front of one investigation engine. The engine reads a message,
lists its claims, checks them against official sources and decides each claim with fixed rules.
Language models only read and (optionally) summarise; they never decide.

## System context

```mermaid
flowchart LR
  subgraph People
    U2[Investor in a browser<br/>phone or computer]
  end
  subgraph Providers
    NIM[NVIDIA NIM<br/>vision + text models]
    ASR[NVIDIA Riva ASR<br/>gRPC]
  end
  subgraph Official sources
    SEBI[SEBI intermediary registers<br/>Excel export + live search<br/>+ inactive registrations]
    RBI[RBI Alert List]
    RDAP[RDAP domain records]
    RULES[Rule table<br/>SEBI regulations and circulars]
  end
  subgraph Jaanch server
    API[Web API]
    Q[(Job queue<br/>Postgres)]
    ENG[Investigation engine<br/>packages/core]
    DB[(Postgres<br/>reports, snapshots,<br/>sessions)]
  end
  WEB[Web app<br/>React]

  U2 <--> WEB <--> API
  API --> Q
  Q --> ENG
  ENG --> NIM
  ENG --> ASR
  ENG --> SEBI
  ENG --> RBI
  ENG --> RDAP
  ENG --> RULES
  ENG --> DB
```

## Packages

| Package            | What it does                                                                                                                                                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`    | Domain schemas (zod), deterministic extraction (registration numbers, UPI IDs, phones, links, emails, EN/HI/Hinglish phrase patterns), claim building and grounding, verification planning, adjudication, the rule table, explanation templates (English + Hindi), report, web view and evidence-summary rendering, and the engine. No I/O. |
| `packages/db`      | One `Db` interface over node-postgres (production) and PGlite (embedded Postgres for development/tests); SQL migrations; repositories; the job queue.                                                                                                                                                                                       |
| `packages/sources` | Official source adapters and their ingestion: SEBI registers (Excel export, live search, inactive list), RBI Alert List, RDAP. Fictional fixtures for development, clearly labelled.                                                                                                                                                        |
| `packages/llm`     | NVIDIA NIM client (202 polling, JSON-mode negotiation, retries), screenshot reader with tiling and consensus re-read, claim extractor, narrator, Riva speech-to-text, live model probe.                                                                                                                                                     |
| `apps/server`      | Composition root: configuration, Fastify HTTP server, web API, event-driven worker, ingestion and operations CLI (and a WhatsApp channel, off by default).                                                                                                                                                                                  |
| `apps/web`         | The web app: compose → progress → report → "I already paid". Renders server-built view models; contains no investigation logic.                                                                                                                                                                                                             |

## The pipeline

```mermaid
flowchart TD
  IN[Input: text, screenshots, voice note, link] --> READ
  READ[Read<br/>vision model transcribes screenshots verbatim<br/>+ independent identifier re-read<br/>speech-to-text for voice notes] --> DET
  DET[Deterministic extraction<br/>registration numbers, UPI, phones, links, emails<br/>EN/HI/Hinglish phrase patterns] --> CLAIMS
  READ --> MODEL[Model extraction<br/>JSON, schema-validated]
  MODEL --> CLAIMS
  CLAIMS[Claim building<br/>every quote and identifier grounded in the transcript<br/>ungrounded model output discarded] --> PLAN
  PLAN[Plan and verify<br/>registry by number / by name, inactive list,<br/>alert list, domain age — with timeouts] --> ADJ
  ADJ[Adjudicate<br/>pure functions + rule table<br/>CONTRADICTED / MATCHES / NOT FOUND / CAN'T CHECK] --> EXPL
  EXPL[Explain<br/>templates EN/HI, evidence, next steps<br/>optional model summary behind a guard] --> OUT
  OUT[Report<br/>stored 7 days] --> CH[Web report view<br/>EN / HI]
```

Which steps involve a model:

| Step                        | Model?                           | Guarantees                                                                                                                        |
| --------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Reading screenshots / audio | Yes                              | Verbatim instructions; unclear fragments listed; second identifier read compared; audio identifiers always "uncertain"            |
| Extraction                  | Yes, plus deterministic patterns | JSON schema validation; quotes and identifiers must occur in the transcript; identifiers taken from deterministic extraction only |
| Verification                | No                               | Official sources only; every access records as-of date, retrieval time, mode (snapshot/live), staleness, fixture flag             |
| Adjudication                | No                               | Pure, deterministic; uncertain readings and loose name bindings cannot produce CONTRADICTED                                       |
| Explanation                 | Optional                         | Templates for every factual sentence; a model summary is shown only if it adds no numbers, identifiers, labels or advice          |

## Claim types and how each is decided

| Claim                                                                                       | Checked against                                                                                                    | Possible verdicts                                                                             |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| SEBI registration (number and/or name)                                                      | SEBI registers (snapshot → live search → inactive list), name comparison over legal/trade/proprietor/contact names | MATCHES, CONTRADICTED (belongs to someone else / cancelled / expired), NOT FOUND, CAN'T CHECK |
| Identity ("this is from X")                                                                 | Registers by name; contact channels vs the record (phone, email domain, website, look-alike domains)               | MATCHES, NOT FOUND, CAN'T CHECK                                                               |
| Guaranteed returns                                                                          | Rule table (registered advisers/analysts/brokers may not promise assured returns)                                  | CONTRADICTED when paired with a SEBI-registration claim, otherwise CAN'T CHECK + warning      |
| Regulator/exchange endorsement                                                              | Rule table (SEBI does not approve securities; exchanges/SEBI do not endorse)                                       | CONTRADICTED, CAN'T CHECK                                                                     |
| Payment destination (UPI/bank/QR/crypto)                                                    | Rule table (validated `@valid` UPI IDs for intermediaries), handle structure                                       | CONTRADICTED, CAN'T CHECK (+ SEBI Check guidance)                                             |
| App install                                                                                 | Link analysis (APK, app store, sideload) + SEBI cautions                                                           | CAN'T CHECK + warning                                                                         |
| Special access (institutional/FPI account, pre-IPO, IPO allotment, block deals, VIP groups) | Rule table (FPI route unavailable to residents) + SEBI/exchange cautions                                           | CONTRADICTED (FPI), CAN'T CHECK + warning                                                     |

Behavioural patterns (urgency, secrecy, moving to private groups, OTP/remote-access requests,
pay-to-withdraw, profit screenshots, accuracy claims, crypto payment, personal UPI IDs) become
warnings with severity, never verdicts. RBI Alert List hits, new domains, look-alike domains,
shorteners and raw-IP links are warnings with evidence.

## How the website uses the engine

The web app (`apps/web`) renders view models built on the server; it contains no investigation
logic. The API (`apps/server/src/channels/web`):

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as Web API
  participant Q as Job queue
  participant E as Engine
  B->>B: compress screenshots (client-side)
  B->>A: POST /api/v1/investigations (text, screenshots, link, voice note)
  A->>A: validate uploads by content, rate-limit, store media briefly
  A->>Q: enqueue investigation.run (payload encrypted)
  A-->>B: id + one-time owner token
  loop every ~1 s
    B->>A: GET /api/v1/investigations/:id
    A-->>B: stage (reading → claims → records → rules → report)
  end
  Q->>E: run
  E-->>Q: report stored (7 days)
  B->>A: GET report view (EN or HI), evidence summary, recovery page
  B->>A: DELETE (owner token) — report erased immediately
```

A WhatsApp channel (`apps/server/src/channels/whatsapp`: Meta Cloud API and Twilio adapters with
signed webhooks) is in the codebase but off (`WHATSAPP_PROVIDER=none`); both providers require a
verified or paid business account. See [technical-decisions.md](technical-decisions.md).

## Data model and retention

| Table                                   | Holds                                                                                                                            | Retention                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `investigations`                        | Status, stage, report JSON (claims, evidence, verdicts, transcript), owner-token hash, requester HMAC                            | 7 days (`REPORT_TTL_DAYS`), or earlier on DELETE    |
| `jobs`                                  | Queue; payloads encrypted with AES-256-GCM where they contain message content or reply addresses; payload scrubbed on completion | Completed jobs deleted after 7 days                 |
| `blobs`                                 | Uploaded media until read                                                                                                        | Deleted right after reading; hard expiry 30 minutes |
| `inbound_messages`                      | Provider message ids (idempotency)                                                                                               | 14 days                                             |
| `registry_entities`, `source_snapshots` | Official register snapshots and their provenance                                                                                 | Replaced on each ingestion                          |
| `alert_list_entries`                    | RBI Alert List snapshot                                                                                                          | Replaced on each ingestion                          |
| `cache_entries`                         | Live lookup cache (SEBI 6 h, RDAP 7 days)                                                                                        | Expiry                                              |

A sweeper deletes expired rows every 6 hours (and via `cli sweep`).

## Freshness and provenance

Every report lists each source consulted with status (ok / unavailable), mode (snapshot / live /
static rule table), the source's own as-of date, retrieval time and a fixture flag. Every
evidence item links to the public page where a person can see the same record. SEBI snapshots
older than 72 hours (`SNAPSHOT_STALE_HOURS`) and RBI Alert List snapshots older than 14 days (the
list changes rarely) are marked stale in the report.

## Failure behaviour

| Failure                               | Behaviour                                                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Language model unavailable or retired | Text is still checked with deterministic patterns; screenshots are reported as unreadable; the report says the AI reader was unavailable |
| SEBI live search down                 | Answers from the snapshot, labelled as such; with no snapshot, CAN'T CHECK                                                               |
| RBI list / RDAP unavailable           | Listed under "Could not check"; nothing inferred                                                                                         |
| Unclear screenshot                    | Identifiers marked uncertain; never CONTRADICTED; "check the number in the original message"                                             |
| Worker crash mid-job                  | Lease expires; job re-queued; investigations are idempotent                                                                              |

## Deployment shape

One Docker image runs everything (API, worker, web app, CLI). On free tiers: Render web
service + Neon Postgres, with the web app optionally on Vercel. See [deployment.md](deployment.md)
and [technical-decisions.md](technical-decisions.md).
