import type { RegistryCategory, RegistryRecord } from '@jaanch/core';
import type { RegistryRepo, SnapshotsRepo } from '@jaanch/db';
import { SEBI_CATEGORIES, listingUrl, type SebiCategoryDef } from './categories.js';
import type { SebiClient } from './client.js';
import { mergeRecords, parseSebiExport, recordsFromExport } from './parse.js';

export const SEBI_SOURCE_ID = 'sebi_intermediaries';
export const SEBI_REGISTRY_SOURCE = 'sebi';

export interface IngestLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface CategoryIngestResult {
  category: RegistryCategory;
  ok: boolean;
  records: number;
  asOf: string | null;
  removed?: number;
  error?: string;
}

/**
 * Snapshot SEBI's registers via the official per-category Excel export. Each category (e.g. all
 * six broker segments) is replaced atomically; a failing category keeps its previous snapshot.
 */
export async function ingestSebiRegisters(deps: {
  client: SebiClient;
  registry: RegistryRepo;
  snapshots: SnapshotsRepo;
  logger?: IngestLogger;
  categories?: RegistryCategory[];
}): Promise<CategoryIngestResult[]> {
  const wanted = deps.categories ? new Set(deps.categories) : null;
  const byCategory = new Map<RegistryCategory, SebiCategoryDef[]>();
  for (const def of SEBI_CATEGORIES) {
    if (wanted && !wanted.has(def.category)) continue;
    byCategory.set(def.category, [...(byCategory.get(def.category) ?? []), def]);
  }

  const results: CategoryIngestResult[] = [];
  for (const [category, defs] of byCategory) {
    const snapshotId = await deps.snapshots.start(
      SEBI_SOURCE_ID,
      category,
      listingUrl(defs[0]!.intmId),
      false,
    );
    try {
      const all: RegistryRecord[] = [];
      const asOfs: string[] = [];
      for (const def of defs) {
        const bytes = await deps.client.fetchExport(def.intmId);
        const parsed = parseSebiExport(bytes);
        if (parsed.rows.length === 0) throw new Error(`empty export for intmId ${def.intmId}`);
        if (parsed.asOf) asOfs.push(parsed.asOf);
        all.push(...recordsFromExport(parsed, def));
        deps.logger?.info(
          {
            category,
            intmId: def.intmId,
            rows: parsed.rows.length,
            asOf: parsed.asOf,
            rssMb: Math.round(process.memoryUsage().rss / 1_048_576),
          },
          'sebi export parsed',
        );
      }
      const merged = mergeRecords(all);
      const removed = await deps.registry.replaceCategory(
        SEBI_REGISTRY_SOURCE,
        category,
        merged,
        snapshotId,
      );
      const asOf = asOfs.sort()[0] ?? null;
      await deps.snapshots.succeed(snapshotId, {
        asOf,
        recordCount: merged.length,
        stats: { rows: all.length, removed },
      });
      results.push({ category, ok: true, records: merged.length, asOf, removed });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await deps.snapshots.fail(snapshotId, message);
      deps.logger?.error(
        { category, err: message },
        'sebi ingestion failed; previous snapshot kept',
      );
      results.push({ category, ok: false, records: 0, asOf: null, error: message });
    }
  }
  return results;
}
