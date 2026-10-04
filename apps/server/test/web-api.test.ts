import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer, waitFor } from './helpers.js';

type Server = Awaited<ReturnType<typeof startTestServer>>;
let s: Server;

beforeAll(async () => {
  s = await startTestServer();
});
afterAll(async () => {
  await s.close();
});

const SCAM = `Sharma Investments
SEBI Registered Research Analyst
Reg No: INH000099991
Guaranteed 30% monthly returns in F&O!
Pay to UPI: 9876501234@ybl
Offer valid today only!`;

function multipart(
  fields: Record<string, string>,
  files: Array<{ name: string; filename: string; type: string; data: Buffer }>,
) {
  const boundary = `----jaanch${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
    );
  }
  for (const f of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\nContent-Type: ${f.type}\r\n\r\n`,
      ),
    );
    chunks.push(f.data, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function waitDone(id: string, locale = 'en') {
  return waitFor(async () => {
    const res = await s.app.inject({
      method: 'GET',
      url: `/api/v1/investigations/${id}?locale=${locale}`,
    });
    const body = res.json();
    return body.status === 'completed' || body.status === 'failed' ? body : null;
  });
}

describe('web API', () => {
  it('runs an investigation end to end and returns a localised report view', async () => {
    const res = await s.app.inject({
      method: 'POST',
      url: '/api/v1/investigations',
      payload: { text: SCAM, locale: 'en' },
    });
    expect(res.statusCode).toBe(202);
    const created = res.json();
    expect(created.id).toMatch(/^J[A-Za-z0-9_-]{22}$/);
    expect(created.ownerToken).toBeTruthy();

    const done = await waitDone(created.id);
    expect(done.status).toBe('completed');
    expect(done.view.fixtureMode).toBe(true);
    expect(done.view.fixtureBanner).toMatch(/DEVELOPMENT DATA/);
    expect(done.view.claims.length).toBeGreaterThan(0);
    // No overall verdict field exists anywhere in the view.
    expect(JSON.stringify(done.view).toLowerCase()).not.toMatch(
      /"(safe|scam|risk_?score|overall)"/,
    );

    const hi = (
      await s.app.inject({ method: 'GET', url: `/api/v1/investigations/${created.id}?locale=hi` })
    ).json();
    expect(hi.view.locale).toBe('hi');

    const summary = await s.app.inject({
      method: 'GET',
      url: `/api/v1/investigations/${created.id}/summary`,
    });
    expect(summary.headers['content-type']).toMatch(/text\/plain/);
    expect(summary.body).toContain('INH000099991');

    const recovery = (
      await s.app.inject({
        method: 'GET',
        url: `/api/v1/investigations/${created.id}/recovery?locale=hi`,
      })
    ).json();
    expect(recovery.steps[0].phone).toBe('1930');
    expect(recovery.summary).toContain('9876501234@ybl');

    // Only the owner token deletes.
    expect(
      (
        await s.app.inject({
          method: 'DELETE',
          url: `/api/v1/investigations/${created.id}`,
          headers: { authorization: 'Bearer wrong' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await s.app.inject({
          method: 'DELETE',
          url: `/api/v1/investigations/${created.id}`,
          headers: { authorization: `Bearer ${created.ownerToken}` },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (await s.app.inject({ method: 'GET', url: `/api/v1/investigations/${created.id}` }))
        .statusCode,
    ).toBe(404);
  });

  it('accepts screenshots, strips metadata, and is honest when no reader is configured', async () => {
    const png = await sharp({
      create: { width: 40, height: 40, channels: 3, background: '#ffffff' },
    })
      .withMetadata({ exif: { IFD0: { Copyright: 'secret-gps-owner' } } })
      .png()
      .toBuffer();
    const body = multipart({ locale: 'en' }, [
      { name: 'files', filename: 'shot.png', type: 'image/png', data: png },
    ]);
    const res = await s.app.inject({
      method: 'POST',
      url: '/api/v1/investigations',
      payload: body.payload,
      headers: body.headers,
    });
    expect(res.statusCode).toBe(202);
    const done = await waitDone(res.json().id);
    expect(done.view.unchecked.map((u: { text: string }) => u.text).join(' ')).toMatch(
      /screenshot/i,
    );
    // The uploaded blob was deleted after reading.
    const { rows } = await s.rt.db.query<{ n: number }>('select count(*)::int as n from blobs');
    expect(rows[0]!.n).toBe(0);
  });

  it('rejects files that are not images or audio, whatever they claim to be', async () => {
    const body = multipart({}, [
      {
        name: 'files',
        filename: 'shot.png',
        type: 'image/png',
        data: Buffer.from('#!/bin/sh\necho pwned\n'),
      },
    ]);
    const res = await s.app.inject({
      method: 'POST',
      url: '/api/v1/investigations',
      payload: body.payload,
      headers: body.headers,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('unsupported_type');
  });

  it('validates input and ids', async () => {
    expect(
      (
        await s.app.inject({
          method: 'POST',
          url: '/api/v1/investigations',
          payload: { text: '   ' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await s.app.inject({ method: 'GET', url: '/api/v1/investigations/not-an-id' })).statusCode,
    ).toBe(404);
    expect(
      (await s.app.inject({ method: 'GET', url: '/api/v1/investigations/J0000000000000000000000' }))
        .statusCode,
    ).toBe(404);
  });

  it('publishes source freshness and public metadata without secrets', async () => {
    const sources = (await s.app.inject({ method: 'GET', url: '/api/v1/sources' })).json();
    expect(sources.sebi.categories.length).toBeGreaterThan(0);
    expect(sources.fixtureMode).toBe(true);
    const meta = await s.app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(meta.body).not.toMatch(/test-secret|AUTH_TOKEN|APP_SECRET/);
  });

  it('sets security headers and serves health checks', async () => {
    const res = await s.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.json()).toEqual({ ok: true, version: '1.0.0' });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect((await s.app.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(200);
  });
});
