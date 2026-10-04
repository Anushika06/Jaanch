import type { Reason } from '../schemas/common.js';
import type { Claim } from '../schemas/claims.js';
import type { Entities } from '../schemas/entities.js';
import type { Evidence } from '../schemas/evidence.js';
import type { ClaimResult, EvidenceGraph, Finding, VerdictCounts } from '../schemas/report.js';
import { reason } from '../adjudicate/context.js';

export function countVerdicts(results: ClaimResult[]): VerdictCounts {
  const counts: VerdictCounts = { CONTRADICTED: 0, MATCHES: 0, NOT_FOUND: 0, CANT_CHECK: 0 };
  for (const r of results) counts[r.verdict] += 1;
  return counts;
}

/**
 * One-line headline, chosen by fixed precedence. It summarises the claim verdicts; it is never
 * an overall safety rating.
 */
export function chooseHeadline(
  results: ClaimResult[],
  findings: Finding[],
  claims: Claim[],
): Reason {
  const counts = countVerdicts(results);
  const notTheirs = results.find(
    (r) => r.verdict === 'CONTRADICTED' && r.reason.code === 'REG_BELONGS_TO_OTHER',
  );
  if (notTheirs) {
    return reason('H_REG_NOT_THEIRS', {
      regNo: notTheirs.reason.params.regNo ?? null,
      officialName: notTheirs.reason.params.officialName ?? null,
    });
  }
  if (counts.CONTRADICTED === 1) return reason('H_CONTRADICTED_ONE');
  if (counts.CONTRADICTED > 1) return reason('H_CONTRADICTED_MANY', { count: counts.CONTRADICTED });
  if (counts.NOT_FOUND > 0) return reason('H_NOT_FOUND');
  if (findings.some((f) => f.severity === 'high')) return reason('H_WARNINGS');
  if (counts.MATCHES > 0) return reason('H_ALL_MATCH');
  if (claims.length > 0) return reason('H_ONLY_CANT_CHECK');
  if (findings.some((f) => f.severity === 'medium')) return reason('H_WARNINGS');
  return reason('H_NO_CLAIMS');
}

/** Provenance graph: claims ↔ entities ↔ evidence ↔ sources/rules. */
export function buildGraph(
  claims: Claim[],
  results: ClaimResult[],
  findings: Finding[],
  evidence: Evidence[],
  entities: Entities,
): EvidenceGraph {
  const nodes: EvidenceGraph['nodes'] = [];
  const edges: EvidenceGraph['edges'] = [];
  const seen = new Set<string>();
  const node = (id: string, type: EvidenceGraph['nodes'][number]['type'], label: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    nodes.push({ id, type, label });
  };

  for (const c of claims) {
    node(c.id, 'claim', c.type);
    const linked: Array<[string | null | undefined, string]> = [];
    if (c.type === 'SEBI_REGISTRATION')
      linked.push([
        c.regNoId,
        entities.registrationNumbers.find((r) => r.id === c.regNoId)?.normalized ?? '',
      ]);
    if (c.type === 'PAYMENT_DESTINATION')
      linked.push([c.upiId, entities.upiIds.find((u) => u.id === c.upiId)?.value ?? '']);
    if (c.type === 'APP_INSTALL')
      linked.push([c.urlId, entities.urls.find((u) => u.id === c.urlId)?.host ?? '']);
    for (const [id, label] of linked) {
      if (!id) continue;
      node(id, 'entity', label);
      edges.push({ from: c.id, to: id, type: 'mentions' });
    }
  }

  for (const e of evidence) {
    node(
      e.id,
      e.kind === 'rule' ? 'rule' : 'evidence',
      e.kind === 'rule' ? e.title.code.replace(/^RULE_/, '') : e.title.code,
    );
    const src = `source:${e.sourceId}`;
    node(src, 'source', e.sourceId);
    edges.push({ from: e.id, to: src, type: e.kind === 'rule' ? 'cites' : 'checked_in' });
  }

  for (const r of results) {
    for (const evId of r.evidenceIds) {
      const e = evidence.find((x) => x.id === evId);
      if (!e) continue;
      const type =
        e.kind === 'registry_absence'
          ? 'absent_in'
          : r.verdict === 'CONTRADICTED'
            ? 'contradicts'
            : r.verdict === 'MATCHES'
              ? 'supports'
              : e.kind === 'rule'
                ? 'cites'
                : 'checked_in';
      edges.push({ from: evId, to: r.claimId, type });
    }
  }

  for (const f of findings) {
    node(f.id, 'finding', f.reason.code);
    for (const evId of f.evidenceIds) edges.push({ from: f.id, to: evId, type: 'flags' });
    for (const cId of f.claimIds) edges.push({ from: f.id, to: cId, type: 'flags' });
  }
  return { nodes, edges };
}
