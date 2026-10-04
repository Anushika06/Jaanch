import twilio from 'twilio';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { detectCommand } from '../src/channels/whatsapp/conversation.js';
import { parseTwilioInbound, userKeyFrom } from '../src/channels/whatsapp/twilio.js';
import { startTestServer, waitFor } from './helpers.js';

const AUTH_TOKEN = 'test-auth-token-0123456789abcdef';
const WEBHOOK = 'https://jaanch.test/webhooks/twilio/whatsapp';
const USER = 'whatsapp:+919812345678';

type Server = Awaited<ReturnType<typeof startTestServer>>;
let s: Server;
let sent: Array<{ to: string; body: string }> = [];
let seq = 0;

beforeAll(async () => {
  s = await startTestServer({
    WHATSAPP_PROVIDER: 'twilio',
    TWILIO_ACCOUNT_SID: 'ACtest00000000000000000000000000',
    TWILIO_AUTH_TOKEN: AUTH_TOKEN,
    TWILIO_WHATSAPP_FROM: 'whatsapp:+14155238886',
  });
  // Stub the provider: record outgoing messages instead of calling Twilio.
  s.rt.transport!.send = async (to: string, body: string) => {
    sent.push({ to, body });
    return { id: `SM${sent.length}` };
  };
});
afterAll(async () => {
  await s.close();
});
beforeEach(() => {
  sent = [];
});

function params(body: string, extra: Record<string, string> = {}) {
  seq += 1;
  return {
    MessageSid: `SMtest${seq}`,
    AccountSid: 'ACtest',
    From: USER,
    To: 'whatsapp:+14155238886',
    Body: body,
    NumMedia: '0',
    WaId: '919812345678',
    ...extra,
  };
}

async function post(
  p: Record<string, string>,
  signature = twilio.getExpectedTwilioSignature(AUTH_TOKEN, WEBHOOK, p),
) {
  return s.app.inject({
    method: 'POST',
    url: '/webhooks/twilio/whatsapp',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signature,
      host: 'jaanch.test',
      'x-forwarded-proto': 'https',
    },
    payload: new URLSearchParams(p).toString(),
  });
}

describe('webhook security', () => {
  it('rejects requests without a valid Twilio signature', async () => {
    expect((await post(params('hello'), 'forged')).statusCode).toBe(403);
    expect((await post(params('hello'), '')).statusCode).toBe(403);
  });

  it('answers valid requests immediately with empty TwiML', async () => {
    const res = await post(params('help'));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/xml/);
    expect(res.body).toBe('<Response/>');
  });

  it('processes each provider message once (Twilio retries are idempotent)', async () => {
    const p = params('help');
    await post(p);
    await post(p);
    await waitFor(async () => sent.length >= 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(sent).toHaveLength(1); // one combined welcome + help reply, not two
    expect(sent[0]!.body).toContain('PAID');
  });
});

describe('conversation', () => {
  it('investigates forwarded content and replies with the report and a link', async () => {
    await post(
      params(
        'Sharma Investments\nSEBI Registered Research Analyst\nReg No: INH000099991\nGuaranteed 30% monthly returns!\nWhatsApp me: +91 98123 45678',
      ),
    );
    const report = await waitFor(
      async () => sent.find((m) => m.body.includes('https://jaanch.test/r/J')),
      15_000,
    );
    expect(sent[0]!.body).toMatch(/Checking/); // acknowledgement first
    expect(report.to).toBe(USER);
    const all = sent.map((m) => m.body).join('\n');
    expect(all).toMatch(/Jaanch report/);
    expect(all).not.toMatch(/\bscam\b/i);
    expect(sent.every((m) => m.body.length <= 1500)).toBe(true);
    // The requester's own number never appears in what we stored.
    const { rows } = await s.rt.db.query<{ report: unknown }>(
      `select report from investigations where channel = 'whatsapp'`,
    );
    expect(JSON.stringify(rows)).not.toContain('98123');
    expect(JSON.stringify(rows)).not.toContain('9812345678');
  });

  it('switches language and answers in Hindi', async () => {
    await post(params('HINDI'));
    await waitFor(async () => sent.some((m) => m.body.includes('हिंदी')));
    sent = [];
    await post(params('मदद'));
    await waitFor(async () => sent.length >= 1);
    expect(sent[0]!.body).toMatch(/नमस्ते/);
    expect(sent[0]!.body).toMatch(/PAID/); // help text is in the same message
    await post(params('english'));
    await waitFor(async () => sent.some((m) => m.body.includes('English')));
  });

  it('routes "PAID" to recovery steps for the last report', async () => {
    await post(params('PAID'));
    const msg = await waitFor(async () => sent.find((m) => m.body.includes('1930')));
    expect(msg.body).toMatch(/cybercrime\.gov\.in/);
    expect(msg.body).toMatch(/\/paid/);
  });

  it('deletes everything on request', async () => {
    await post(params('DELETE'));
    await waitFor(async () => sent.some((m) => /deleted/i.test(m.body)));
    const { rows } = await s.rt.db.query<{ n: number }>(
      `select count(*)::int as n from investigations where channel = 'whatsapp'`,
    );
    expect(rows[0]!.n).toBe(0);
  });
});

describe('parsing', () => {
  it('only treats exact command words as commands', () => {
    expect(detectCommand('HELP')).toBe('help');
    expect(detectCommand('Paid!')).toBe('paid');
    expect(detectCommand('join letter-now')).toBe('join');
    expect(detectCommand('Need help? Join our VIP group for guaranteed profits')).toBeNull();
  });

  it('keys users consistently across webhook and API listings', () => {
    expect(userKeyFrom('whatsapp:+919812345678', '919812345678')).toBe(
      userKeyFrom('whatsapp:+919812345678'),
    );
    expect(userKeyFrom('whatsapp:IN.abc', undefined, 'IN.abc')).toBe('ext:IN.abc');
    const msg = parseTwilioInbound({
      MessageSid: 'SM1',
      From: USER,
      Body: 'x',
      NumMedia: '1',
      MediaUrl0: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME1',
      MediaContentType0: 'image/jpeg',
      Forwarded: 'true',
    });
    expect(msg.media[0]).toMatchObject({ providerMediaId: 'ME1', contentType: 'image/jpeg' });
    expect(msg.forwarded).toBe(true);
  });
});
