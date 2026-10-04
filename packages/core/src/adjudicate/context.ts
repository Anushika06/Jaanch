import type { ParamValue, Reason, Severity } from '../schemas/common.js';
import type { Evidence, EvidenceKind, SourceId } from '../schemas/evidence.js';
import type { Binding, ClaimResult, Finding, FindingKind, Unchecked } from '../schemas/report.js';
import type { ReasonCode } from '../explain/catalog/en.js';
import { RULES, type RuleId } from '../rules/table.js';

export function reason(code: ReasonCode, params: Record<string, ParamValue> = {}): Reason {
  return { code, params };
}

/** Mutable accumulator shared by the adjudication steps. Output order is deterministic. */
export class AdjudicationContext {
  readonly results: ClaimResult[] = [];
  readonly findings: Finding[] = [];
  readonly unchecked: Unchecked[] = [];
  readonly bindings: Binding[] = [];
  readonly evidence: Evidence[] = [];
  private readonly evidenceByKey = new Map<string, string>();
  private readonly findingKeys = new Set<string>();
  private readonly uncheckedKeys = new Set<string>();
  private counter = 0;

  constructor(
    readonly now: Date,
    /** True when any source answered from development fixtures. */
    readonly fixtureMode: boolean,
  ) {}

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }

  /** Register a piece of evidence once; returns its id. */
  addEvidence(
    key: string,
    e: {
      sourceId: SourceId;
      kind: EvidenceKind;
      title: Reason;
      fields?: Record<string, string | null>;
      url: string | null;
      asOf: string | null;
      retrievedAt: string | null;
      isFixture: boolean;
    },
  ): string {
    const existing = this.evidenceByKey.get(key);
    if (existing) return existing;
    const id = this.nextId('ev');
    this.evidence.push({ id, ...e, fields: e.fields ?? {} });
    this.evidenceByKey.set(key, id);
    return id;
  }

  /** Evidence entry for a cited rule (one per rule, shared by every claim citing it). */
  ruleEvidence(ruleId: RuleId): string {
    const rule = RULES[ruleId];
    const primary = rule.citations[0]!;
    return this.addEvidence(`rule:${ruleId}`, {
      sourceId: 'jaanch_rules',
      kind: 'rule',
      title: reason(`RULE_${ruleId}` as ReasonCode),
      fields: Object.fromEntries(
        rule.citations.flatMap((c, i) => [
          [`source_${i + 1}`, c.title],
          [`reference_${i + 1}`, [c.reference, c.clause].filter(Boolean).join(' — ')],
          [`date_${i + 1}`, c.date],
          [`url_${i + 1}`, c.url],
        ]),
      ),
      url: primary.url,
      asOf: rule.verifiedOn,
      retrievedAt: null,
      isFixture: false,
    });
  }

  result(r: Omit<ClaimResult, 'evidenceIds' | 'ruleIds' | 'caveats'> & Partial<ClaimResult>): void {
    const ruleIds = r.ruleIds ?? [];
    const evidenceIds = [
      ...(r.evidenceIds ?? []),
      ...ruleIds.map((id) => this.ruleEvidence(id as RuleId)),
    ];
    this.results.push({
      claimId: r.claimId,
      verdict: r.verdict,
      reason: r.reason,
      evidenceIds: [...new Set(evidenceIds)],
      ruleIds,
      caveats: r.caveats ?? [],
    });
  }

  finding(
    key: string,
    f: {
      kind: FindingKind;
      severity: Severity;
      reason: Reason;
      evidenceIds?: string[];
      ruleIds?: RuleId[];
      claimIds?: string[];
      entityIds?: string[];
    },
  ): void {
    if (this.findingKeys.has(key)) return;
    this.findingKeys.add(key);
    const ruleIds = f.ruleIds ?? [];
    this.findings.push({
      id: this.nextId('finding'),
      kind: f.kind,
      severity: f.severity,
      reason: f.reason,
      evidenceIds: [
        ...new Set([...(f.evidenceIds ?? []), ...ruleIds.map((id) => this.ruleEvidence(id))]),
      ],
      ruleIds,
      claimIds: f.claimIds ?? [],
      entityIds: f.entityIds ?? [],
    });
  }

  uncheckedItem(
    key: string,
    u: Omit<Unchecked, 'id' | 'sourceId' | 'claimIds'> & Partial<Unchecked>,
  ): void {
    if (this.uncheckedKeys.has(key)) return;
    this.uncheckedKeys.add(key);
    this.unchecked.push({
      id: this.nextId('unchecked'),
      reason: u.reason,
      cause: u.cause,
      sourceId: u.sourceId ?? null,
      claimIds: u.claimIds ?? [],
    });
  }

  binding(b: Omit<Binding, 'id'>): string {
    const existing = this.bindings.find(
      (x) => x.recordEvidenceId === b.recordEvidenceId && x.claimedName === b.claimedName,
    );
    if (existing) {
      existing.claimIds = [...new Set([...existing.claimIds, ...b.claimIds])];
      return existing.id;
    }
    const id = this.nextId('binding');
    this.bindings.push({ id, ...b });
    return id;
  }
}
