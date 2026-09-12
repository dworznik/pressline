import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conformance } from '@pressline/conformance';
import type { CatalogueResponse } from '@pressline/contract';
import { nodeBackend } from '@pressline/render/node';
import { afterEach, describe, expect, it } from 'vitest';
import { finalize, loadDesign } from '$lib/server/designs';
import { makeRuntime, type Runtime } from '$lib/server/runtime';
import { fsStore } from '$lib/server/store/fs';

/**
 * The sample Engine's own tests are the conformance suite run in-process
 * (docs/SPEC.md seam 4), plus the designer's finalize path through the same
 * runtime a request would use.
 */
const spec = (width: number, height: number) => ({
  width,
  height,
  dpi: 150,
  formats: ['png' as const],
  colorSpace: 'srgb' as const,
  alpha: 'allowed' as const,
  placement: 'front',
  technique: 'dtg',
});
const catalogue: CatalogueResponse = {
  protocolVersion: '1',
  currency: 'EUR',
  offers: [
    {
      slug: 'tee-black-front',
      name: 'Black tee, front print',
      placement: 'front',
      technique: 'dtg',
      retailPrice: { amount: 2500, currency: 'EUR' },
      aspect: null,
      variants: [
        { key: 'black-m', label: 'Black / M', spec: spec(1800, 2400), specHash: 'x'.repeat(64) },
      ],
    },
    {
      slug: 'mug',
      name: 'Mug (wrap)',
      placement: 'default',
      technique: 'sublimation',
      retailPrice: { amount: 1500, currency: 'EUR' },
      aspect: null,
      variants: [
        { key: 'one', label: 'One size', spec: spec(2700, 1100), specHash: 'y'.repeat(64) },
      ],
    },
  ],
};

const SECRET = 'engine-secret-for-tests';
let dir: string;
let runtime: Runtime;
const boot = () => {
  dir = mkdtempSync(join(tmpdir(), 'sample-engine-'));
  runtime = makeRuntime(
    {
      secret: SECRET,
      engineSlug: 'sample',
      publicUrl: 'https://engine.test',
      presslineUrl: 'https://shop.test',
    },
    {
      store: fsStore(dir, 'https://engine.test'),
      backend: nodeBackend,
      catalogue: async () => catalogue,
    },
  );
  return runtime;
};
/** One fetch for the Engine's protocol and the files it hosts. */
const engineFetch: typeof fetch = async (input, init) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  if (url.pathname.startsWith('/files/')) {
    const bytes = await runtime.engine.store.get(url.pathname.slice('/files/'.length));
    if (!bytes) return new Response('', { status: 404 });
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.get('range') ?? '');
    const end = range ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    return new Response(new Blob([bytes.slice(0, end + 1) as BlobPart]), {
      status: range ? 206 : 200,
      headers: { 'content-type': 'image/png', 'content-range': `bytes 0-${end}/${bytes.length}` },
    });
  }
  return runtime.handler(req);
};

describe('sample Engine', () => {
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('finalizes a template design, pre-renders every fitting Offer, and marks the rest ineligible', async () => {
    const { engine } = boot();
    const design = await finalize(engine, { template: { text: 'Hello', background: '#123456' } });
    expect(design.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(design.previewUrl).toBe(`https://engine.test/files/previews/${design.id}.png`);
    // The 3:4 tee is rendered; the 27:11 mug does not fit and is left out of `offers`.
    expect(Object.keys(design.printfiles)).toHaveLength(1);
    expect(design.offers).toEqual(['tee-black-front']);
    const stored = await loadDesign(engine.store, design.id);
    expect(stored?.printfiles).toEqual(design.printfiles);
    const file = Object.values(design.printfiles)[0]!;
    expect(file).toMatchObject({ width: 1800, height: 2400, contentType: 'image/png' });
    expect(
      await engine.store.get(`printfiles/${design.id}/${Object.keys(design.printfiles)[0]}.png`),
    ).toHaveLength(file.bytes);
  });

  it('passes the conformance suite', async () => {
    const { engine } = boot();
    const design = await finalize(engine, { template: { text: 'Conformant' } });
    const report = await conformance({
      baseUrl: 'https://engine.test',
      secret: SECRET,
      designId: design.id,
      fetch: engineFetch,
    });
    expect(report.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name}`)).toEqual([
      '✓ health',
      '✓ design',
      '✓ preview',
      '✓ render',
      '✓ idempotent',
      '✓ printfile',
      '✓ rejects',
    ]);
    expect(report.ok).toBe(true);
  });

  it('refuses requests without the shared secret and unknown designs', async () => {
    boot();
    const anon = await runtime.handler(new Request('https://engine.test/health'));
    expect(anon.status).toBe(401);
    const wrong = await runtime.handler(
      new Request('https://engine.test/health', { headers: { authorization: 'Bearer nope' } }),
    );
    expect(wrong.status).toBe(401);
    const missing = await runtime.handler(
      new Request('https://engine.test/designs/does-not-exist-1', {
        headers: { authorization: `Bearer ${SECRET}` },
      }),
    );
    expect(missing.status).toBe(404);
  });
});

describe('the /files route', () => {
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env['FILES_DIR'];
    delete process.env['ENGINE_SECRET'];
  });

  it('serves previews and printfiles with Range, hides metadata and sources, and refuses traversal', async () => {
    const { engine } = boot();
    process.env['FILES_DIR'] = dir;
    process.env['ENGINE_SECRET'] = SECRET;
    const design = await finalize(engine, { template: { text: 'Files' } });
    const { GET } = await import('../src/routes/files/[...path]/+server');
    const get = (path: string, headers: Record<string, string> = {}) =>
      GET({
        params: { path },
        platform: undefined,
        request: new Request(`https://engine.test/files/${path}`, { headers }),
      } as never);
    const full = await get(`previews/${design.id}.png`);
    expect(full.status).toBe(200);
    expect(full.headers.get('cache-control')).toContain('immutable');
    const ranged = await get(`previews/${design.id}.png`, { range: 'bytes=0-15' });
    expect(ranged.status).toBe(206);
    expect((await ranged.arrayBuffer()).byteLength).toBe(16);
    expect(ranged.headers.get('content-range')).toMatch(/^bytes 0-15\/\d+$/);
    expect((await get(`previews/${design.id}.png`, { range: 'bytes=999999999-' })).status).toBe(
      416,
    );
    await expect(get(`designs/${design.id}.json`)).rejects.toMatchObject({ status: 404 });
    await expect(get('../package.json')).rejects.toMatchObject({ status: 404 });
    await expect(get('previews/../../package.json')).rejects.toMatchObject({ status: 404 });
  });
});
