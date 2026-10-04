import type { Reason } from '../schemas/common.js';
import type { SourceRun } from '../schemas/evidence.js';
import type { InvestigationInput } from '../schemas/input.js';
import type { ModelExtraction, ModelIdentifierReading } from '../schemas/model-io.js';
import { Report, REPORT_SCHEMA_VERSION, type Unchecked } from '../schemas/report.js';
import type { Transcript, TranscriptSegment } from '../schemas/transcript.js';
import { adjudicate } from '../adjudicate/index.js';
import { reason } from '../adjudicate/context.js';
import { nextSteps } from '../actions/routing.js';
import { buildClaims } from '../claims/build.js';
import {
  findPhones,
  findRegistrationNumbers,
  findUpiIds,
  runDeterministicExtraction,
} from '../extract/index.js';
import { guardNarrative, narrativeFacts } from '../explain/narrative.js';
import { buildGraph, chooseHeadline, countVerdicts } from '../report/assemble.js';
import { RULES } from '../rules/table.js';
import { alnumOnly, cleanText } from '../text/normalize.js';
import { runVerification } from '../verify/run.js';
import type { EngineOptions, EnginePorts, ProgressEvent, RunContext } from './ports.js';

export const PIPELINE_VERSION = '1.0.0';

/** Replace each digit sequence (last 10 digits, separators allowed) with a neutral marker. */
export function redactDigitSequences(text: string, digits: string[]): string {
  let out = text;
  for (const d of digits) {
    const core = d.replace(/\D/g, '').slice(-10);
    if (core.length < 8) continue;
    const pattern = new RegExp(`(?:\\+?\\d{1,3}[\\s-]*)?${core.split('').join('[\\s-]*')}`, 'g');
    out = out.replace(pattern, '[your number]');
  }
  return out;
}

class TimeoutError extends Error {
  constructor() {
    super('timeout');
  }
}

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new TimeoutError()), ms);
  try {
    return await Promise.race([
      fn(controller.signal),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => reject(controller.signal.reason ?? new TimeoutError()),
          { once: true },
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', onAbort);
  }
}

/**
 * Identifiers the first read found but an independent second read did not confirm. These are
 * marked unclear so they can never ground a CONTRADICTED verdict.
 */
export function consensusDisagreements(text: string, second: ModelIdentifierReading): string[] {
  const secondRegs = new Set(
    second.registrationNumbers.flatMap((v) => findRegistrationNumbers(v).map((r) => r.normalized)),
  );
  const secondUpis = new Set(second.upiIds.map((v) => v.toLowerCase().replace(/\s+/g, '')));
  const secondPhones = new Set(second.phoneNumbers.map((v) => alnumOnly(v).slice(-10)));
  const out: string[] = [];
  for (const r of findRegistrationNumbers(text)) if (!secondRegs.has(r.normalized)) out.push(r.raw);
  for (const u of findUpiIds(text)) if (!secondUpis.has(u.value.value)) out.push(u.raw);
  for (const p of findPhones(text))
    if (!secondPhones.has(alnumOnly(p.raw).slice(-10))) out.push(p.raw);
  return out;
}

/**
 * The Jaanch investigation pipeline:
 *   read → extract → identify claims → plan & verify → adjudicate → explain.
 * The model reads and (optionally) narrates; sources verify; deterministic code adjudicates.
 */
export class InvestigationEngine {
  constructor(
    private readonly ports: EnginePorts,
    private readonly options: EngineOptions,
  ) {}

  private now(): Date {
    return (this.ports.clock ?? (() => new Date()))();
  }

  async run(input: InvestigationInput, ctx: RunContext): Promise<Report> {
    const timings: Record<string, number> = {};
    const degraded: Reason[] = [];
    const progress = (e: ProgressEvent) => ctx.onProgress?.(e);
    const mark = (stage: string, started: number) =>
      (timings[stage] = Math.round(performance.now() - started));

    // ---------------------------------------------------------------- 1. read
    let started = performance.now();
    progress({ stage: 'reading', detail: { parts: input.parts.length } });
    const transcript = await this.read(input, ctx.signal);
    if (ctx.redactDigits?.length) {
      for (const s of transcript.segments) s.text = redactDigitSequences(s.text, ctx.redactDigits);
    }
    mark('reading', started);

    // ---------------------------------------------------------------- 2. extract & identify claims
    started = performance.now();
    progress({ stage: 'extracting' });
    const det = runDeterministicExtraction(transcript.segments);
    let model: ModelExtraction | null = null;
    const joined = transcript.segments.map((s) => s.text).join('\n\n---\n\n');
    if (joined.trim()) {
      if (this.ports.extractor) {
        try {
          model = await withTimeout(
            (s) => this.ports.extractor!.extract(joined, s),
            this.options.modelTimeoutMs,
            ctx.signal,
          );
        } catch (err) {
          this.ports.logger?.warn(
            { err: String(err) },
            'model extraction failed; continuing with deterministic extraction',
          );
          degraded.push(reason('U_MODEL_UNAVAILABLE'));
        }
      } else {
        degraded.push(reason('U_MODEL_UNAVAILABLE'));
      }
    }
    const built = buildClaims(transcript.segments, det, model);
    if (built.discarded > 0)
      this.ports.logger?.info(
        { discarded: built.discarded },
        'ungrounded model statements discarded',
      );
    mark('extracting', started);

    // ---------------------------------------------------------------- 3. verify
    started = performance.now();
    progress({ stage: 'checking', detail: { claims: built.claims.length } });
    const verification = await runVerification(built.claims, built.entities, this.ports.sources, {
      timeoutMs: this.options.sourceTimeoutMs,
    });
    mark('checking', started);

    // ---------------------------------------------------------------- 4. adjudicate
    started = performance.now();
    progress({ stage: 'adjudicating' });
    const fixtureMode = verification.runs.some((r) => r.isFixture);
    const adj = adjudicate({
      claims: built.claims,
      patterns: built.patterns,
      entities: built.entities,
      transcript,
      verification,
      now: this.now(),
      fixtureMode,
    });
    const unchecked: Unchecked[] = [
      ...adj.unchecked,
      ...degraded.map((d, i) => ({
        id: `unchecked-degraded-${i + 1}`,
        reason: d,
        cause: 'source_unavailable' as const,
        sourceId: null,
        claimIds: [],
      })),
    ];
    const sources: SourceRun[] = [...verification.runs];
    const ruleEvidence = adj.evidence.filter((e) => e.kind === 'rule');
    if (ruleEvidence.length) {
      sources.push({
        sourceId: 'jaanch_rules',
        status: 'ok',
        mode: 'static',
        asOf:
          Object.values(RULES)
            .map((r) => r.verifiedOn)
            .sort()
            .at(-1) ?? null,
        retrievedAt: null,
        stale: false,
        isFixture: false,
        queries: ruleEvidence.length,
        latencyMs: 0,
        note: null,
      });
    }
    mark('adjudicating', started);

    // ---------------------------------------------------------------- 5. explain & route
    started = performance.now();
    progress({ stage: 'explaining' });
    const steps = nextSteps({
      claims: built.claims,
      results: adj.results,
      findings: adj.findings,
      bindings: adj.bindings,
      evidence: adj.evidence,
      entities: built.entities,
    });
    const headline = chooseHeadline(adj.results, adj.findings, built.claims);
    const noClaims = built.claims.length === 0 && adj.findings.length === 0;
    const completedAt = this.now().toISOString();

    const draft = {
      id: ctx.id,
      schemaVersion: REPORT_SCHEMA_VERSION,
      pipelineVersion: PIPELINE_VERSION,
      createdAt: ctx.createdAt.toISOString(),
      completedAt,
      locale: ctx.locale,
      channel: input.channel,
      input: { parts: input.parts.map((p, i) => ({ partIndex: i, kind: p.kind })) },
      transcript: transcript.segments.map((s) => ({
        id: s.id,
        partIndex: s.partIndex,
        origin: s.origin,
        quality: s.quality,
        text: s.text,
      })),
      entities: built.entities,
      claims: built.claims,
      patterns: built.patterns,
      results: adj.results,
      findings: adj.findings,
      unchecked,
      bindings: adj.bindings,
      evidence: adj.evidence,
      sources,
      nextSteps: steps,
      summary: { counts: countVerdicts(adj.results), headline, noClaims, narrative: null },
      graph: buildGraph(built.claims, adj.results, adj.findings, adj.evidence, built.entities),
      meta: {
        models: {
          reader: transcript.segments.some((s) => s.origin === 'image' || s.origin === 'audio')
            ? (this.ports.reader?.modelId ?? null)
            : null,
          extractor: model ? (this.ports.extractor?.modelId ?? null) : null,
          narrator: null as string | null,
        },
        timingsMs: timings,
        fixtureMode,
        degraded,
      },
    };

    // Optional plain-language overview, written by the model from rendered facts only and
    // accepted only if the guard finds no new facts, labels or advice. Without a valid model
    // narrative there is none: the headline and claim list already say everything.
    if (this.options.narrative && !noClaims && this.ports.narrator) {
      const facts = narrativeFacts(draft, ctx.locale);
      try {
        const candidate = (
          await withTimeout(
            (s) => this.ports.narrator!.narrate(facts, s),
            this.options.modelTimeoutMs,
            ctx.signal,
          )
        ).trim();
        const guard = guardNarrative(candidate, facts);
        if (guard.ok) {
          draft.meta.models.narrator = this.ports.narrator.modelId;
          (draft.summary as { narrative: unknown }).narrative = {
            locale: ctx.locale,
            text: candidate,
            by: 'model',
            model: this.ports.narrator.modelId,
          };
        } else {
          this.ports.logger?.warn(
            { problems: guard.problems },
            'narrative rejected by guard; omitted',
          );
        }
      } catch (err) {
        this.ports.logger?.warn({ err: String(err) }, 'narrator failed; narrative omitted');
      }
    }
    mark('explaining', started);
    timings.total = Object.values(timings).reduce((a, b) => a + b, 0);

    const report = Report.parse(draft);
    progress({ stage: 'done' });
    return report;
  }

  private async read(input: InvestigationInput, signal?: AbortSignal): Promise<Transcript> {
    const segments: TranscriptSegment[] = [];
    const unreadParts: Transcript['unreadParts'] = [];
    const { reader, blobs } = this.ports;

    for (const [i, part] of input.parts.entries()) {
      const id = `seg-${i + 1}`;
      if (part.kind === 'text') {
        const text = cleanText(part.text);
        if (text)
          segments.push({
            id,
            partIndex: i,
            origin: 'text',
            text,
            quality: 'good',
            unclearFragments: [],
            readBy: 'verbatim',
          });
        continue;
      }
      if (part.kind === 'url') {
        segments.push({
          id,
          partIndex: i,
          origin: 'url',
          text: part.url.trim(),
          quality: 'good',
          unclearFragments: [],
          readBy: 'verbatim',
        });
        continue;
      }

      const bytes = await blobs.get(part.blobRef).catch(() => null);
      try {
        if (!bytes) {
          unreadParts.push({ partIndex: i, kind: part.kind, reason: 'error' });
          continue;
        }
        if (part.kind === 'image') {
          if (!reader) {
            unreadParts.push({ partIndex: i, kind: 'image', reason: 'reader_unavailable' });
            continue;
          }
          // The independent identifier re-read doesn't depend on the transcript, so both reads run
          // concurrently. If the re-read fails, the transcript's own uncertainty flags still apply.
          const secondRead =
            this.options.ocrConsensus && reader.readIdentifiers
              ? withTimeout(
                  (s) => reader.readIdentifiers!(bytes, part.mime, s),
                  this.options.modelTimeoutMs,
                  signal,
                ).catch(() => null)
              : Promise.resolve(null);
          const reading = await withTimeout(
            (s) => reader.readImage(bytes, part.mime, s),
            this.options.modelTimeoutMs,
            signal,
          );
          const text = cleanText(reading.text);
          if (reading.quality === 'unreadable' || !text) {
            unreadParts.push({ partIndex: i, kind: 'image', reason: 'unreadable' });
            continue;
          }
          const unclear = [...reading.unclear];
          const second = await secondRead;
          if (second) unclear.push(...consensusDisagreements(text, second));
          segments.push({
            id,
            partIndex: i,
            origin: 'image',
            text,
            quality: reading.quality,
            unclearFragments: unclear,
            readBy: reader.modelId,
          });
        } else {
          if (!reader?.transcribeAudio) {
            unreadParts.push({
              partIndex: i,
              kind: 'audio',
              reason: reader ? 'unsupported' : 'reader_unavailable',
            });
            continue;
          }
          const heard = await withTimeout(
            (s) => reader.transcribeAudio!(bytes, part.mime, s),
            this.options.modelTimeoutMs,
            signal,
          );
          const text = heard ? cleanText(heard.text) : '';
          if (!text) {
            unreadParts.push({
              partIndex: i,
              kind: 'audio',
              reason: heard ? 'unreadable' : 'unsupported',
            });
            continue;
          }
          // Speech recognition is never exact: every identifier heard in audio is uncertain.
          segments.push({
            id,
            partIndex: i,
            origin: 'audio',
            text,
            quality: 'partial',
            unclearFragments: [],
            readBy: reader.modelId,
          });
        }
      } catch (err) {
        this.ports.logger?.warn(
          { err: String(err), partIndex: i, kind: part.kind },
          'reading input part failed',
        );
        unreadParts.push({ partIndex: i, kind: part.kind, reason: 'error' });
      } finally {
        // Media is deleted as soon as it has been read, whatever the outcome.
        await blobs.discard(part.blobRef).catch(() => undefined);
      }
    }
    return { segments, unreadParts };
  }
}
