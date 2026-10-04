import { createHmac } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseMetaWebhook } from '../src/channels/whatsapp/meta.js';
import type { InboundMedia } from '../src/channels/whatsapp/transport.js';
import { startTestServer, waitFor } from './helpers.js';

const APP_SECRET = 'meta-app-secret-for-tests-0123456789';
const PHONE_ID = '109876543210';
const USER = '919812345678';

type Server = Awaited<ReturnType<typeof startTestServer>>;
let s: Server;
let sent: Array<{ to: string; body: string }> = [];
let downloads: InboundMedia[] = [];
let seq = 0;

beforeAll(async () => {
  s = await startTestServer({
    WHATSAPP_PROVIDER: 'meta',
    META_WA_ACCESS_TOKEN: 'test-access-token',
    META_WA_PHONE_NUMBER_ID: PHONE_ID,
    META_APP_SECRET: APP_SECRET,
    META_WA_VERIFY_TOKEN: 'verify-me-please',
    META_WA_DISPLAY_NUMBER: '+1 555-010-0000',
  });
  // Stub the Graph API: record replies and serve media locally.
  s.rt.transport!.send = async (to: string, body: string) => {
    sent.push({ to, body });
    return { id: `wamid.out${sent.length}` };
  };
  const png = await sharp({
    create: { width: 40, height: 40, channels: 3, background: '#ffffff' },
  })
    .png()
    .toBuffer();
  s.rt.transport!.downloadMedia = async (media: InboundMedia) => {
    downloads.push(media);
    return { bytes: new Uint8Array(png), contentType: 'image/png' };
  };
});
afterAll(async () => {
  await s.close();
});
beforeEach(() => {
  sent = [];
  downloads = [];
});

function webhook(message: Record<string, unknown>, phoneNumberId = PHONE_ID) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA-ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550100000', phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: 'Test User' }, wa_id: USER }],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

function text(body: string): Record<string, unknown> {
  seq += 1;
  return {
    from: USER,
    id: `wamid.in${seq}`,
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: 'text',
    text: { body },
  };
}

const sign = (raw: string, secret = APP_SECRET) =>
  `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

function post(body: unknown, signature: string | null | undefined = undefined) {
  const raw = JSON.stringify(body);
  const sig = signature === undefined ? sign(raw) : signature;
  return s.app.inject({
    method: 'POST',
    url: '/webhooks/meta/whatsapp',
    headers: { 'content-type': 'application/json', ...(sig ? { 'x-hub-signature-256': sig } : {}) },
    payload: raw,
  });
}

describe('Meta webhook security', () => {
  it('answers the subscription check only with the right verify token', async () => {
    const ok = await s.app.inject({
      method: 'GET',
      url: '/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me-please&hub.challenge=12345',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('12345');
    const bad = await s.app.inject({
      method: 'GET',
      url: '/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345',
    });
    expect(bad.statusCode).toBe(403);
  });

  it('rejects unsigned and wrongly signed payloads', async () => {
    expect((await post(webhook(text('HELP')), null)).statusCode).toBe(403);
    expect((await post(webhook(text('HELP')), sign('{}'))).statusCode).toBe(403);
    expect((await post(webhook(text('HELP')), sign('x', 'other-secret'))).statusCode).toBe(403);
    await new Promise((r) => setTimeout(r, 200));
    expect(sent).toHaveLength(0);
  });
});

describe('Meta conversation', () => {
  it('replies to HELP once, even when Meta redelivers the webhook', async () => {
    const msg = webhook(text('HELP'));
    expect((await post(msg)).statusCode).toBe(200);
    expect((await post(msg)).statusCode).toBe(200);
    await waitFor(async () => sent.length >= 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(USER);
    expect(sent[0]!.body).toMatch(/PAID/);
  });

  it('investigates forwarded text and replies with the report link', async () => {
    await post(
      webhook(
        text(
          'Sharma Investments\nSEBI Registered Research Analyst\nReg No: INH000099991\nGuaranteed 30% monthly returns!',
        ),
      ),
    );
    const report = await waitFor(
      async () => sent.find((m) => m.body.includes('https://jaanch.test/r/J')),
      15_000,
    );
    expect(sent[0]!.body).toMatch(/Checking/);
    expect(report.to).toBe(USER);
  });

  it('downloads screenshots by media id', async () => {
    seq += 1;
    await post(
      webhook({
        from: USER,
        id: `wamid.in${seq}`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'image',
        image: { id: '1234567890', mime_type: 'image/jpeg', caption: '' },
      }),
    );
    await waitFor(async () => downloads.length >= 1);
    expect(downloads[0]!.providerMediaId).toBe('1234567890');
    await waitFor(async () => sent.some((m) => /Got it/.test(m.body)));
    // Let this conversation finish (no reader in tests, so the report says what couldn't be read).
    await waitFor(async () => sent.some((m) => m.body.includes('https://jaanch.test/r/J')), 15_000);
  });

  it('ignores events for a different phone number', async () => {
    await post(webhook(text('HELP'), '999999999999'));
    await new Promise((r) => setTimeout(r, 300));
    expect(sent).toHaveLength(0);
  });

  it('describes the WhatsApp number for the web page', async () => {
    const res = await s.app.inject({ method: 'GET', url: '/api/v1/meta' });
    const wa = (res.json() as { whatsapp: Record<string, unknown> }).whatsapp;
    expect(wa).toMatchObject({
      enabled: true,
      provider: 'meta',
      number: '+1 555-010-0000',
      joinCode: null,
      link: 'https://wa.me/15550100000?text=HELP',
      testNumber: true,
    });
  });
});

describe('Meta payload parsing', () => {
  it('reads captions, documents, voice notes and forwarding flags; skips stickers', () => {
    const base = { from: USER, timestamp: '1791109192' };
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: PHONE_ID },
                messages: [
                  {
                    ...base,
                    id: 'a',
                    type: 'image',
                    image: { id: '1', mime_type: 'image/jpeg', caption: 'see this' },
                    context: { forwarded: true, frequently_forwarded: true },
                  },
                  {
                    ...base,
                    id: 'b',
                    type: 'document',
                    document: { id: '2', mime_type: 'image/png' },
                  },
                  {
                    ...base,
                    id: 'c',
                    type: 'audio',
                    audio: { id: '3', mime_type: 'audio/ogg; codecs=opus', voice: true },
                  },
                  { ...base, id: 'd', type: 'sticker', sticker: { id: '4' } },
                ],
                statuses: [
                  {
                    id: 'wamid.x',
                    status: 'failed',
                    errors: [{ code: 131047, title: 'Re-engagement message' }],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const { messages, statuses } = parseMetaWebhook(payload, PHONE_ID);
    expect(messages.map((m) => m.providerMessageId)).toEqual(['a', 'b', 'c']);
    expect(messages[0]).toMatchObject({
      text: 'see this',
      forwarded: true,
      frequentlyForwarded: true,
      replyTo: USER,
    });
    expect(messages[0]!.userKey).toBe(`tel:${USER}`);
    expect(messages[1]!.media[0]).toMatchObject({ providerMediaId: '2', contentType: 'image/png' });
    expect(messages[2]!.media[0]!.contentType).toMatch(/^audio\/ogg/);
    expect(messages[0]!.receivedAt).toBe(new Date(1791109192 * 1000).toISOString());
    expect(statuses).toEqual([
      {
        id: 'wamid.x',
        status: 'failed',
        errors: [{ code: 131047, title: 'Re-engagement message' }],
      },
    ]);
  });
});
