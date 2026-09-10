import { specHash, type DesignResponse, type PrintfileSpec } from '@pressline/contract';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrintfileState } from '$lib/server/printfile/ensure';
import { parseImageHeader } from '$lib/server/printfile/validate';
import type { MemoryPrintfileAnswer } from '$lib/server/services/memory';
import { catalog, offers } from './fixtures/catalogue';
import { jpeg, png } from './fixtures/images';
import { makeTestApp, type HostedFile, type TestApp } from './harness';

/** The tee's front-print Spec as the Catalogue derives it (12×16 in @150 dpi, alpha allowed). */
const teeSpec: PrintfileSpec = {
  width: 1800,
  height: 2400,
  dpi: 150,
  formats: ['png'],
  colorSpace: 'srgb',
  alpha: 'allowed',
  placement: 'front',
  technique: 'dtg',
};

const design: DesignResponse = {
  id: 'design-portrait-1',
  title: 'Blue heron',
  sellable: true,
  previewUrl: 'https://engine.test/p/heron.png',
  aspect: { w: 3, h: 4 },
};
const withdrawn: DesignResponse = { ...design, id: 'design-withdrawn', sellable: false };
const square: DesignResponse = { ...design, id: 'design-square-01', aspect: { w: 1, h: 1 } };
const URL_OK = 'https://engine.test/files/heron/front.png';

const ready = (
  over: Partial<Extract<MemoryPrintfileAnswer, { kind: 'ready' }>> = {},
): MemoryPrintfileAnswer => ({
  kind: 'ready',
  url: URL_OK,
  ...over,
});

const boot = (render: MemoryPrintfileAnswer, files: Record<string, HostedFile>, waitMs = 1000) =>
  makeTestApp({
    config: { catalogue: { offers }, printfile: { waitMs } },
    catalog,
    engines: {
      engines: {
        sample: {
          designs: { [design.id]: design, [withdrawn.id]: withdrawn, [square.id]: square },
          printfiles: { [design.id]: render },
        },
      },
    },
    files,
  });

const teeFile = (bytes = png({ width: 1800, height: 2400, totalBytes: 5000 })): HostedFile => ({
  bytes,
  contentType: 'image/png',
});

const ensure = (app: TestApp, offer = 'tee-black-front', variant = 'black-m', id = design.id) =>
  app.json<PrintfileState & { reason?: string; message?: string }>(
    `/api/designs/sample/${id}/printfile`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ offer, variant }),
    },
  );

describe('POST /api/designs/{engine}/{designId}/printfile (ensure Printfile)', () => {
  let app: TestApp;
  afterEach(() => app?.dispose());

  it('answers ready when the Engine has the file and it validates', async () => {
    app = await boot(ready({ bytes: 5000 }), { [URL_OK]: teeFile() });
    const { status, body } = await ensure(app);
    expect(status).toBe(200);
    expect(body.status).toBe('ready');
    if (body.status === 'ready') {
      expect(body.printfile).toMatchObject({ url: URL_OK, width: 1800, height: 2400, bytes: 5000 });
      expect(body.printfile.specHash).toBe(await Effect.runPromise(specHash(teeSpec)));
    }
  });

  it('is idempotent: a second request is served from the stored Printfile without asking the Engine', async () => {
    app = await boot(ready({ bytes: 5000 }), { [URL_OK]: teeFile() });
    await ensure(app);
    const calls = await app.engineCalls();
    const { status } = await ensure(app);
    expect(status).toBe(200);
    // Only the design lookup (sellable? eligible?) reaches the Engine; no render call.
    expect(await app.engineCalls()).toBe(calls + 1);
  });

  it('polls a rendering Engine within the wait bound and then answers ready', async () => {
    app = await boot(
      { kind: 'rendering', times: 2, retryAfterMs: 10, then: ready({ bytes: 5000 }) },
      { [URL_OK]: teeFile() },
    );
    const { status, body } = await ensure(app);
    expect(status).toBe(200);
    expect(body.status).toBe('ready');
  });

  it('answers 202 preparing when the Engine is still rendering beyond the bound, and GET status reports it', async () => {
    app = await boot({ kind: 'rendering', times: 100, retryAfterMs: 50, then: ready() }, {}, 60);
    const { status, body } = await ensure(app);
    expect(status).toBe(202);
    expect(body).toEqual({ status: 'preparing', retryAfterMs: 250 }); // floored
    const poll = await app.json<PrintfileState>(
      `/api/designs/sample/${design.id}/printfile?offer=tee-black-front&variant=black-m`,
    );
    expect(poll.status).toBe(202);
  });

  it('422s with rejected when the Engine cannot satisfy the Spec, and hides that Offer for the Design from then on', async () => {
    app = await boot({ kind: 'rejected', code: 'aspect_mismatch', message: 'square only' }, {});
    const { status, body } = await ensure(app);
    expect(status).toBe(422);
    expect(body).toMatchObject({ reason: 'rejected' });
    expect(body.message).toMatch(/aspect_mismatch/);

    const page = await app.json<{ offers: { slug: string }[] }>(`/api/designs/sample/${design.id}`);
    expect(page.body.offers.map((o) => o.slug)).not.toContain('tee-black-front');
    const calls = await app.engineCalls();
    const again = await ensure(app);
    expect(again.body).toMatchObject({ reason: 'not_eligible' });
    expect(await app.engineCalls()).toBe(calls + 1); // the design lookup only; the Engine is not asked to render again
  });

  it('422s for a design that is not sellable, and for an Offer the design is not eligible for', async () => {
    app = await boot(ready(), { [URL_OK]: teeFile() });
    const gone = await ensure(app, 'tee-black-front', 'black-m', withdrawn.id);
    expect(gone.status).toBe(422);
    expect(gone.body).toMatchObject({ reason: 'not_sellable' });
    const wrong = await ensure(app, 'poster-18x24', '18x24', square.id);
    expect(wrong.body).toMatchObject({ reason: 'not_eligible' }); // square; poster wants 0.7–0.8
  });

  describe('header validation (each failure class)', () => {
    const cases: Array<[string, MemoryPrintfileAnswer, HostedFile | undefined, RegExp]> = [
      ['spec_hash', ready({ specHash: 'b'.repeat(64) }), teeFile(), /spec_hash/],
      [
        'format (declared type not accepted)',
        ready({ contentType: 'image/jpeg' }),
        teeFile(),
        /format/,
      ],
      [
        'unreachable',
        ready({ url: 'https://engine.test/missing.png' }),
        undefined,
        /unreachable|status/,
      ],
      ['status', ready(), { ...teeFile(), status: 500 }, /status/],
      ['content_type', ready(), { ...teeFile(), contentType: 'text/html' }, /content_type/],
      [
        'content_type (another image type)',
        ready(),
        { ...teeFile(), contentType: 'image/jpeg' },
        /content_type/,
      ],
      ['content_length', ready({ bytes: 999 }), teeFile(), /content_length/],
      [
        'header',
        ready({ bytes: 5000 }),
        { bytes: new Uint8Array(5000), contentType: 'image/png' },
        /header/,
      ],
      [
        'dimensions',
        ready({ bytes: 5000 }),
        teeFile(png({ width: 1800, height: 2000, totalBytes: 5000 })),
        /dimensions/,
      ],
    ];
    for (const [name, render, file, pattern] of cases) {
      it(`rejects: ${name}`, async () => {
        app = await boot(render, file ? { [URL_OK]: file } : {});
        const { status, body } = await ensure(app);
        expect(status).toBe(422);
        expect(body).toMatchObject({ reason: 'invalid' });
        expect(body.message).toMatch(pattern);
      });
    }

    it('rejects alpha where the placement forbids it, and accepts an opaque JPEG there', async () => {
      const posterUrl = 'https://engine.test/files/heron/poster.png';
      const posterDesign: DesignResponse = {
        ...design,
        id: 'design-poster-001',
        aspect: { w: 3, h: 4 },
      };
      const rgba = png({ width: 2700, height: 3600, colourType: 6, totalBytes: 7000 });
      app = await makeTestApp({
        config: { catalogue: { offers: [{ ...offers[1]!, aspect: { min: 0.7, max: 0.8 } }] } },
        catalog,
        engines: {
          engines: {
            sample: {
              designs: { [posterDesign.id]: posterDesign },
              printfiles: { [posterDesign.id]: ready({ url: posterUrl, bytes: 7000 }) },
            },
          },
        },
        files: { [posterUrl]: { bytes: rgba, contentType: 'image/png' } },
      });
      const { status, body } = await ensure(app, 'poster-18x24', '18x24', posterDesign.id);
      expect(status).toBe(422);
      expect(body.message).toMatch(/alpha/);
      await app.dispose();

      const jpg = jpeg({ width: 2700, height: 3600, totalBytes: 7000 });
      const jpgUrl = 'https://engine.test/files/heron/poster.jpg';
      app = await makeTestApp({
        config: { catalogue: { offers: [offers[1]!] } },
        catalog,
        engines: {
          engines: {
            sample: {
              designs: { [posterDesign.id]: posterDesign },
              printfiles: {
                [posterDesign.id]: ready({ url: jpgUrl, bytes: 7000, contentType: 'image/jpeg' }),
              },
            },
          },
        },
        files: { [jpgUrl]: { bytes: jpg, contentType: 'image/jpeg' } },
      });
      const ok = await ensure(app, 'poster-18x24', '18x24', posterDesign.id);
      expect(ok.status).toBe(200);
    });

    it('never downloads the whole file: a server ignoring Range still only costs the header prefix', async () => {
      const big = png({ width: 1800, height: 2400, totalBytes: 2 * 1024 * 1024 });
      app = await boot(ready({ bytes: big.length }), {
        [URL_OK]: { bytes: big, contentType: 'image/png', ignoreRange: true },
      });
      const { status } = await ensure(app);
      expect(status).toBe(200);
    });
  });
});

describe('parseImageHeader', () => {
  it('reads PNG dimensions and alpha (colour type or tRNS)', () => {
    expect(parseImageHeader(png({ width: 10, height: 20, colourType: 2 }))).toEqual({
      format: 'png',
      width: 10,
      height: 20,
      hasAlpha: false,
    });
    expect(parseImageHeader(png({ width: 10, height: 20, colourType: 6 }))?.hasAlpha).toBe(true);
    expect(
      parseImageHeader(png({ width: 10, height: 20, colourType: 3, trns: true }))?.hasAlpha,
    ).toBe(true);
  });
  it('reads JPEG dimensions from SOF0 and reports no alpha', () => {
    expect(parseImageHeader(jpeg({ width: 640, height: 480 }))).toEqual({
      format: 'jpeg',
      width: 640,
      height: 480,
      hasAlpha: false,
    });
  });
  it('returns undefined for anything else', () => {
    expect(parseImageHeader(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });
});
