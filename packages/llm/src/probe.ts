/**
 * Live model probe: which hosted NVIDIA models work best for Jaanch right now?
 *
 *   pnpm --filter @jaanch/llm probe            (needs NVIDIA_API_KEY in .env)
 *
 * Checks each candidate's lifecycle status (live / retired), then scores live candidates on the
 * real tasks: transcribing the demo screenshots (English + Hindi) and extracting claims from known
 * messages. Prints a table and a recommendation for LLM_VISION_MODEL / LLM_TEXT_MODEL.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { NimExtractor, NimReader } from './adapters.js';
import { NimClient } from './nim.js';

function loadEnv() {
  for (const dir of [
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd(), '../..'),
  ]) {
    const f = path.join(dir, '.env');
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
    }
    return dir;
  }
  return null;
}

const VISION_CANDIDATES = [
  'google/gemma-4-31b-it',
  'z-ai/glm-5.3-flash',
  'moonshotai/kimi-k3',
  'deepseek-ai/deepseek-v4.1-flash',
  'meta/muse-glimmer-30b',
  'google/gemma-3-12b-it',
];
const TEXT_CANDIDATES = [
  'google/gemma-4-31b-it',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'z-ai/glm-5.3',
  'moonshotai/kimi-k3',
  'deepseek-ai/deepseek-v4.1-flash',
  'openai/gpt-oss-20b',
];

const SCREENSHOTS = [
  {
    file: 'scam-en.png',
    expect: ['INH000011431', '9876501234@ybl', '30%', 'Sharma Investments', 't.me/+SharmaVIPcalls'],
  },
  { file: 'scam-hi.png', expect: ['INH000011431', '9876501234@ybl', '5%', 'पक्का', 'शर्मा'] },
];

const TEXTS = [
  {
    text: 'Sharma Investments\nSEBI Registered Research Analyst\nReg No: INH000011431\nGuaranteed 30% monthly returns in F&O!\nPay to UPI: 9876501234@ybl\nOffer valid today only!',
    check: (x: Awaited<ReturnType<NimExtractor['extract']>>) => [
      x.registrationClaims.some(
        (r) =>
          r.number?.replace(/\s/g, '') === 'INH000011431' && /sharma/i.test(r.holderName ?? ''),
      ),
      x.returnPromises.some((r) => r.percent === 30 && r.period === 'month'),
      x.paymentRequests.some((p) => p.method === 'upi'),
      x.pressure.some((p) => p.kind === 'urgency'),
    ],
  },
  {
    text: 'नमस्ते जी, हम शर्मा इन्वेस्टमेंट्स से हैं — SEBI रजिस्टर्ड रिसर्च एनालिस्ट, रजि. नं. INH000011431। रोज़ 5% पक्का मुनाफ़ा, कोई नुकसान नहीं! आज ही जुड़ें। पेमेंट UPI: 9876501234@ybl',
    check: (x: Awaited<ReturnType<NimExtractor['extract']>>) => [
      x.registrationClaims.some((r) => r.number?.replace(/\s/g, '') === 'INH000011431'),
      x.returnPromises.some((r) => r.percent === 5 && r.period === 'day'),
      x.paymentRequests.length > 0,
      x.pressure.some((p) => p.kind === 'urgency'),
    ],
  },
  {
    text: 'Reminder: Your SIP of Rs 5,000 in XYZ Flexi Cap Fund will be debited on 10 Oct. Mutual fund investments are subject to market risks.',
    check: (x: Awaited<ReturnType<NimExtractor['extract']>>) => [
      x.returnPromises.length === 0,
      x.registrationClaims.length === 0,
    ],
  },
];

async function main() {
  const envDir = loadEnv();
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    console.error('NVIDIA_API_KEY is not set. Add it to .env at the repository root.');
    process.exit(1);
  }
  const baseUrl = process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1';
  const client = new NimClient({ apiKey, baseUrl, timeoutMs: 90_000 });
  const repoRoot = envDir ?? process.cwd();

  console.log('Checking access…');
  const models = await client.listModels().catch((e: unknown) => {
    console.error(`Could not list models: ${String(e)}`);
    process.exit(1);
  });
  console.log(`API key works. ${models.length} models visible.\n`);

  const status = async (m: string) => (await client.modelStatus(m)).status;
  const live = async (list: string[]) => {
    const out: string[] = [];
    for (const m of list) {
      const s = await status(m);
      console.log(`  ${s.padEnd(8)} ${m}`);
      if (s === 'live') out.push(m);
    }
    return out;
  };

  console.log('Vision candidates:');
  const vision = await live(VISION_CANDIDATES);
  console.log('Text candidates:');
  const text = await live(TEXT_CANDIDATES);

  console.log('\nOCR (screenshot → transcript):');
  const visionScores: Array<{ model: string; score: number; ms: number; error?: string }> = [];
  for (const model of vision) {
    const reader = new NimReader(client, model, { maxInlineBytes: 180_000 });
    let hits = 0;
    let total = 0;
    const started = Date.now();
    let error: string | undefined;
    for (const shot of SCREENSHOTS) {
      const bytes = new Uint8Array(
        readFileSync(path.join(repoRoot, 'demo/screenshots', shot.file)),
      );
      try {
        const r = await reader.readImage(bytes, 'image/png', AbortSignal.timeout(120_000));
        const norm = r.text.replace(/\s+/g, ' ');
        for (const e of shot.expect) {
          total += 1;
          if (norm.includes(e)) hits += 1;
        }
      } catch (err) {
        total += shot.expect.length;
        error = String(err).slice(0, 120);
      }
    }
    visionScores.push({
      model,
      score: hits / total,
      ms: Date.now() - started,
      ...(error ? { error } : {}),
    });
    console.log(
      `  ${model.padEnd(42)} ${((100 * hits) / total).toFixed(0).padStart(3)}%  ${((Date.now() - started) / 1000).toFixed(1)}s${error ? `  error: ${error}` : ''}`,
    );
  }

  console.log('\nExtraction (transcript → structured claims):');
  const textScores: Array<{ model: string; score: number; ms: number; error?: string }> = [];
  for (const model of text) {
    const extractor = new NimExtractor(client, model);
    let ok = 0;
    let total = 0;
    const started = Date.now();
    let error: string | undefined;
    for (const t of TEXTS) {
      try {
        const out = await extractor.extract(t.text, AbortSignal.timeout(120_000));
        const results = t.check(out);
        ok += results.filter(Boolean).length;
        total += results.length;
      } catch (err) {
        total += 4;
        error = String(err).slice(0, 120);
      }
    }
    textScores.push({
      model,
      score: ok / total,
      ms: Date.now() - started,
      ...(error ? { error } : {}),
    });
    console.log(
      `  ${model.padEnd(42)} ${((100 * ok) / total).toFixed(0).padStart(3)}%  ${((Date.now() - started) / 1000).toFixed(1)}s${error ? `  error: ${error}` : ''}`,
    );
  }

  const best = (xs: typeof visionScores) =>
    [...xs].sort((a, b) => b.score - a.score || a.ms - b.ms)[0];
  const v = best(visionScores);
  const tx = best(textScores);
  console.log('\nRecommendation:');
  if (v) console.log(`  LLM_VISION_MODEL=${v.model}`);
  if (tx) console.log(`  LLM_TEXT_MODEL=${tx.model}\n  LLM_NARRATOR_MODEL=${tx.model}`);
}

void main();
