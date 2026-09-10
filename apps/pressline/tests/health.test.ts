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
      config: { name: 'Test Shop', currency: 'EUR', engines: ['sample'] },
    });
    expect(body.schemaVersion).toBeGreaterThanOrEqual(1);
  });

  it('reflects demo mode from config', async () => {
    app = await makeTestApp({ demo: true });
    const { body } = await app.json<HealthResponse>('/api/health');
    expect(body.demo).toBe(true);
  });

  it('404s unknown API paths', async () => {
    app = await makeTestApp();
    expect((await app.fetch('/api/nope')).status).toBe(404);
  });
});
