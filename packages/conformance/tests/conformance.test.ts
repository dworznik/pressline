import type { DesignResponse } from '@pressline/contract';
import { describe, expect, it } from 'vitest';
import { conformance, formatReport } from '../src/index.js';
import { fakeEngine } from './fake-engine.js';

/**
 * Seam 4 (docs/SPEC.md): the conformance suite against Engines that behave
 * and Engines that do not, judged by the report an Engine developer reads.
 */
const design: DesignResponse = {
  id: 'heron-0001',
  title: 'Blue heron',
  sellable: true,
  previewUrl: 'https://engine.test/p/heron.png',
  aspect: { w: 3, h: 4 },
};
const run = (fetch: typeof globalThis.fetch) =>
  conformance({ baseUrl: 'https://engine.test', secret: 's3cret', designId: design.id, fetch });
const names = (r: Awaited<ReturnType<typeof run>>) =>
  Object.fromEntries(r.checks.map((c) => [c.name, c.ok]));

describe('conformance suite', () => {
  it('passes a well-behaved Engine that renders at once', async () => {
    const report = await run(fakeEngine({ design }).fetch);
    expect(report.ok, formatReport(report)).toBe(true);
    expect(names(report)).toEqual({
      health: true,
      design: true,
      preview: true,
      render: true,
      idempotent: true,
      printfile: true,
      rejects: true,
    });
    expect(formatReport(report)).toMatch(/✓ render {6}answered 200 ready at once/);
    expect(formatReport(report)).toMatch(
      /✓ printfile {3}https:\/\/engine\.test\/files\/heron-0001\/[0-9a-f]{8}\.png: 1200×1600 image\/png/,
    );
    expect(formatReport(report)).toMatch(/Conformant\.$/);
  });

  it('passes an Engine that answers 202 and then 200', async () => {
    const report = await run(fakeEngine({ design, renderingTimes: 2 }).fetch);
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.name === 'render')?.detail).toBe(
      'answered 202 (retry after 300 ms), then 200 ready',
    );
  });

  it('names each broken rule: hash echo, file size, idempotency, impossible Spec, preview, version', async () => {
    const wrongHash = await run(fakeEngine({ design, wrongHash: true }).fetch);
    expect(wrongHash.ok).toBe(false);
    expect(wrongHash.checks.find((c) => c.name === 'printfile')).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/^spec_hash: /),
    });

    const wrongSize = await run(
      fakeEngine({ design, fileSize: { width: 600, height: 800 } }).fetch,
    );
    expect(wrongSize.checks.find((c) => c.name === 'printfile')?.detail).toMatch(
      /^dimensions: file is 600×800, spec requires 1200×1600/,
    );

    const fresh = await run(fakeEngine({ design, freshUrls: true }).fetch);
    expect(fresh.checks.find((c) => c.name === 'idempotent')).toMatchObject({ ok: false });
    expect(fresh.checks.find((c) => c.name === 'printfile')?.ok).toBe(true);

    const lenient = await run(fakeEngine({ design, acceptsAnything: true }).fetch);
    expect(lenient.checks.find((c) => c.name === 'rejects')?.detail).toBe(
      'answered ready to a 100:1 Spec instead of 422 PrintfileRejected',
    );

    const noPreview = await run(fakeEngine({ design, previewStatus: 404 }).fetch);
    expect(noPreview.checks.find((c) => c.name === 'preview')?.detail).toContain('HTTP 404');

    const old = await run(fakeEngine({ design, protocolVersion: '0' }).fetch);
    expect(old.checks.find((c) => c.name === 'health')?.detail).toBe(
      'protocol version 0, this suite speaks 1',
    );
    expect(formatReport(old)).toMatch(/1 check\(s\) failed\.$/);
  });

  it('stops early when the Engine does not answer at all', async () => {
    const report = await conformance({
      baseUrl: 'https://engine.test',
      secret: 's',
      designId: 'x',
      fetch: async () => new Response('', { status: 500 }),
    });
    expect(report.ok).toBe(false);
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]?.name).toBe('health');
  });

  it('refuses an insecure base URL before touching the network', async () => {
    await expect(
      conformance({ baseUrl: 'http://engine.example', secret: 's', designId: 'x' }),
    ).rejects.toSatisfy((e: unknown) => String(e).includes('InsecureEngineBaseUrl'));
  });
});
