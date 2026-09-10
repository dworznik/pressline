import { afterEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './harness';
import type { HealthResponse } from '$lib/server/http/api';

describe('GET /api/health', () => {
  let app: TestApp;
  afterEach(() => app?.dispose());

  it('reports protocol version, schema version and a config summary', async () => {
    app = await makeTestApp();
    const { status, body } = await app.json<HealthResponse>('/api/health');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      protocolVersion: '1',
      demo: false,
      config: { name: 'Test Shop', currency: 'EUR', offers: 0 },
      engines: [{ slug: 'sample', enabled: true, protocolVersion: '1' }],
    });
    expect(body.schemaVersion).toBeGreaterThanOrEqual(1);
  });

  it('reflects demo mode from config', async () => {
    app = await makeTestApp({ config: { demo: true } });
    const { body } = await app.json<HealthResponse>('/api/health');
    expect(body.demo).toBe(true);
  });

  it('disables an Engine whose protocol version does not match, and says so', async () => {
    app = await makeTestApp({ engines: { engines: { sample: { protocolVersion: '2' } } } });
    const { body } = await app.json<HealthResponse>('/api/health');
    expect(body.engines[0]).toMatchObject({ slug: 'sample', enabled: false, protocolVersion: '2' });
    expect(body.engines[0]!.reason).toMatch(/protocol version 2/);
  });

  it('disables an Engine that is unreachable at startup, without failing boot', async () => {
    app = await makeTestApp({ engines: { engines: { sample: { down: true } } } });
    const { status, body } = await app.json<HealthResponse>('/api/health');
    expect(status).toBe(200);
    expect(body.engines[0]).toMatchObject({ slug: 'sample', enabled: false, transient: true });
    expect(body.engines[0]!.reason).toMatch(/unreachable/);
  });

  it('404s unknown API paths', async () => {
    app = await makeTestApp();
    expect((await app.fetch('/api/nope')).status).toBe(404);
  });
});
