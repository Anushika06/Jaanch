import { z } from 'zod';

/**
 * Pull the first JSON object out of model text: handles code fences, leading prose and trailing
 * commentary. Returns null when no parseable object is present.
 */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf('{');
  if (start < 0) return null;
  // Scan for the matching closing brace, respecting strings.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** JSON Schema for a zod schema, simplified for guided-decoding engines. */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, {
    target: 'draft-7',
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseModelJson<T>(text: string, schema: z.ZodType<T>): ParseOutcome<T> {
  const raw = extractJson(text);
  if (raw === null) return { ok: false, error: 'no JSON object found in model output' };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    };
  }
  return { ok: true, value: parsed.data };
}
