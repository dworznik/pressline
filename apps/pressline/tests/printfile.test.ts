import { specHash, type DesignResponse, type PrintfileSpec } from '@pressline/contract'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { findStored, type PrintfileState } from '$lib/server/printfile/ensure'
import type { MemoryPrintfileAnswer } from '$lib/server/services/memory'
import { catalog, offers } from './fixtures/catalog'
import { jpeg, png } from './fixtures/images'
import { makeTestApp, type HostedFile, type TestApp } from './harness'

/** The tee's front-print Spec as the Catalog derives it (12×16 in @150 dpi, alpha allowed). */
const teeSpec: PrintfileSpec = {
  width: 1800,
  height: 2400,
  dpi: 150,
  formats: ['png'],
  colorSpace: 'srgb',
  alpha: 'allowed',
  placement: 'front',
  technique: 'dtg',
}

const design: DesignResponse = {
  id: 'design-portrait-1',
  title: 'Blue heron',
  sellable: true,
  previewUrl: 'https://engine.test/p/heron.png',
  aspect: { w: 3, h: 4 },
}
const withdrawn: DesignResponse = { ...design, id: 'design-withdrawn', sellable: false }
const square: DesignResponse = { ...design, id: 'design-square-01', aspect: { w: 1, h: 1 } }
const URL_OK = 'https://engine.test/files/heron/front.png'

const ready = (
  over: Partial<Extract<MemoryPrintfileAnswer, { kind: 'ready' }>> = {},
): MemoryPrintfileAnswer => ({
  kind: 'ready',
  url: URL_OK,
  ...over,
})

const boot = (render: MemoryPrintfileAnswer, files: Record<string, HostedFile>, waitMs = 1000) =>
  makeTestApp({
    config: { catalog: { offers }, printfile: { waitMs } },
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
  })

const teeFile = (bytes = png({ width: 1800, height: 2400, totalBytes: 5000 })): HostedFile => ({
  bytes,
  contentType: 'image/png',
})

const ensure = (app: TestApp, offer = 'tee-black-front', variant = 'black-m', id = design.id) =>
  app.json<PrintfileState & { reason?: string; message?: string }>(
    `/api/designs/sample/${id}/printfile`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ offer, variant }),
    },
  )

describe('POST /api/designs/{engine}/{designId}/printfile (ensure Printfile)', () => {
  let app: TestApp
  afterEach(() => app?.dispose())

  it('answers ready when the Engine has the file and it validates', async () => {
    app = await boot(ready({ bytes: 5000 }), { [URL_OK]: teeFile() })
    const { status, body } = await ensure(app)
    expect(status).toBe(200)
    expect(body.status).toBe('ready')
    if (body.status === 'ready') {
      expect(body.printfile).toMatchObject({ url: URL_OK, width: 1800, height: 2400, bytes: 5000 })
      expect(body.printfile.specHash).toBe(await Effect.runPromise(specHash(teeSpec)))
    }
  })

  it('is idempotent: a second request is served from the stored Printfile without asking the Engine', async () => {
    app = await boot(ready({ bytes: 5000 }), { [URL_OK]: teeFile() })
    await ensure(app)
    const calls = await app.engineCalls()
    const { status } = await ensure(app)
    expect(status).toBe(200)
    // Only the design lookup (sellable? eligible?) reaches the Engine; no render call.
    expect(await app.engineCalls()).toBe(calls + 1)
  })

  it('polls a rendering Engine within the wait bound and then answers ready', async () => {
    app = await boot(
      { kind: 'rendering', times: 2, retryAfterMs: 10, next: ready({ bytes: 5000 }) },
      { [URL_OK]: teeFile() },
    )
    const { status, body } = await ensure(app)
    expect(status).toBe(200)
    expect(body.status).toBe('ready')
  })

  it('answers 202 preparing when the Engine is still rendering beyond the bound, and GET status reports it', async () => {
    app = await boot({ kind: 'rendering', times: 100, retryAfterMs: 50, next: ready() }, {}, 60)
    const { status, body } = await ensure(app)
    expect(status).toBe(202)
    expect(body).toEqual({ status: 'preparing', retryAfterMs: 250 }) // floored
    const poll = await app.json<PrintfileState>(
      `/api/designs/sample/${design.id}/printfile?offer=tee-black-front&variant=black-m`,
    )
    expect(poll.status).toBe(202)
  })

  it('422s with rejected when the Engine cannot satisfy the Spec, and hides that Offer for the Design from then on', async () => {
    app = await boot({ kind: 'rejected', code: 'aspect_mismatch', message: 'square only' }, {})
    const { status, body } = await ensure(app)
    expect(status).toBe(422)
    expect(body).toMatchObject({ reason: 'rejected' })
    expect(body.message).toMatch(/aspect_mismatch/)

    const page = await app.json<{ offers: { slug: string }[] }>(`/api/designs/sample/${design.id}`)
    expect(page.body.offers.map((o) => o.slug)).not.toContain('tee-black-front')
    const calls = await app.engineCalls()
    const again = await ensure(app)
    expect(again.body).toMatchObject({ reason: 'not_eligible' })
    expect(await app.engineCalls()).toBe(calls + 1) // the design lookup only; the Engine is not asked to render again
  })

  it('422s for a design that is not sellable, and for an Offer the design is not eligible for', async () => {
    app = await boot(ready(), { [URL_OK]: teeFile() })
    const gone = await ensure(app, 'tee-black-front', 'black-m', withdrawn.id)
    expect(gone.status).toBe(422)
    expect(gone.body).toMatchObject({ reason: 'not_sellable' })
    const wrong = await ensure(app, 'poster-18x24', '18x24', square.id)
    expect(wrong.body).toMatchObject({ reason: 'not_eligible' }) // square; poster wants 0.7–0.8
  })

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
    ]
    for (const [name, render, file, pattern] of cases) {
      it(`rejects: ${name}`, async () => {
        app = await boot(render, file ? { [URL_OK]: file } : {})
        const { status, body } = await ensure(app)
        expect(status).toBe(422)
        expect(body).toMatchObject({ reason: 'invalid' })
        expect(body.message).toMatch(pattern)
      })
    }

    const posterDesign: DesignResponse = {
      ...design,
      id: 'design-poster-001',
      aspect: { w: 3, h: 4 },
    }
    /** The poster (alpha forbidden) with the given file hosted as its Printfile. */
    const bootPoster = (bytes: Uint8Array, contentType: 'image/png' | 'image/jpeg') => {
      const url = `https://engine.test/files/heron/poster.${contentType === 'image/png' ? 'png' : 'jpg'}`
      return makeTestApp({
        config: { catalog: { offers: [{ ...offers[1]!, aspect: { min: 0.7, max: 0.8 } }] } },
        catalog,
        engines: {
          engines: {
            sample: {
              designs: { [posterDesign.id]: posterDesign },
              printfiles: { [posterDesign.id]: ready({ url, bytes: bytes.length, contentType }) },
            },
          },
        },
        files: { [url]: { bytes, contentType } },
      })
    }
    const poster = (app: TestApp) => ensure(app, 'poster-18x24', '18x24', posterDesign.id)

    it('rejects alpha where the placement forbids it, and accepts an opaque JPEG there', async () => {
      app = await bootPoster(
        png({ width: 2700, height: 3600, colorType: 6, totalBytes: 7000 }),
        'image/png',
      )
      const { status, body } = await poster(app)
      expect(status).toBe(422)
      expect(body.message).toMatch(/alpha/)
      await app.dispose()

      app = await bootPoster(jpeg({ width: 2700, height: 3600, totalBytes: 7000 }), 'image/jpeg')
      const ok = await poster(app)
      expect(ok.status).toBe(200)
    })

    it('rejects a forbidden placement when transparency sits past the header window (#117)', async () => {
      // A 70 000-byte iCCP pushes tRNS and IDAT beyond the 64 KB read: the file has alpha, unseen.
      const hidden = png({ width: 2700, height: 3600, colorType: 2, iccpBytes: 70_000, trns: true })
      app = await bootPoster(hidden, 'image/png')
      const { status, body } = await poster(app)
      expect(status).toBe(422)
      expect(body).toMatchObject({ reason: 'invalid' })
      expect(body.message).toMatch(/alpha/)
      await app.dispose()

      // Without tRNS the window is just as inconclusive, so the precautionary answer is the same.
      const opaque = png({ width: 2700, height: 3600, colorType: 2, iccpBytes: 70_000 })
      app = await bootPoster(opaque, 'image/png')
      const again = await poster(app)
      expect(again.status).toBe(422)
      expect(again.body.message).toMatch(/alpha/)
    })

    it('accepts an unseen alpha where the placement allows it', async () => {
      const file = png({ width: 1800, height: 2400, colorType: 2, iccpBytes: 70_000 })
      app = await boot(ready({ bytes: file.length }), { [URL_OK]: teeFile(file) })
      const { status } = await ensure(app)
      expect(status).toBe(200)
    })

    /** One case per rejection the header alone settles (#87 §1). */
    const headerRules: Array<[string, ReturnType<typeof png>]> = [
      ['bit_depth', png({ width: 1800, height: 2400, bitDepth: 16, totalBytes: 5000 })],
      ['color_type', png({ width: 1800, height: 2400, colorType: 3, totalBytes: 5000 })],
      ['interlaced', png({ width: 1800, height: 2400, interlace: 1, totalBytes: 5000 })],
    ]
    for (const [reason, bytes] of headerRules) {
      it(`rejects: ${reason}`, async () => {
        app = await boot(ready({ bytes: 5000 }), { [URL_OK]: teeFile(bytes) })
        const { status, body } = await ensure(app)
        expect(status).toBe(422)
        expect(body).toMatchObject({ reason: 'invalid' })
        expect(body.message).toMatch(new RegExp(reason))
      })
    }

    it('raises the first refusal on the checkout path, however many the file earns', async () => {
      const bad = png({
        width: 1800,
        height: 2400,
        bitDepth: 16,
        colorType: 3,
        interlace: 1,
        totalBytes: 5000,
      })
      app = await boot(ready({ bytes: 5000 }), { [URL_OK]: teeFile(bad) })
      const { status, body } = await ensure(app)
      expect(status).toBe(422)
      // Table order: bit_depth comes first, and the Customer path stops there.
      expect(body.message).toMatch(/bit_depth/)
      expect(body.message).not.toMatch(/interlaced/)
    })

    it('never downloads the whole file: a server ignoring Range still only costs the header prefix', async () => {
      const big = png({ width: 1800, height: 2400, totalBytes: 2 * 1024 * 1024 })
      app = await boot(ready({ bytes: big.length }), {
        [URL_OK]: { bytes: big, contentType: 'image/png', ignoreRange: true },
      })
      const { status } = await ensure(app)
      expect(status).toBe(200)
    })
  })

  describe('the Inspection record (#87 §5)', () => {
    const stored = async (app: TestApp) =>
      app.run(findStored('sample', design.id, await Effect.runPromise(specHash(teeSpec))))

    it('sells a deviating Printfile and records what Validation saw', async () => {
      // No sRGB chunk and no pHYs: two Deviations, and a file that still sells.
      app = await boot(ready({ bytes: 5000 }), { [URL_OK]: teeFile() })
      expect((await ensure(app)).status).toBe(200)
      const row = await stored(app)
      expect(row._tag).toBe('Success')
      const printfile = row._tag === 'Success' ? row.value : undefined
      expect(printfile?.inspection?.header).toMatchObject({
        format: 'png',
        width: 1800,
        height: 2400,
        bitDepth: 8,
      })
      expect(printfile?.inspection?.deviations.map((d) => d.code)).toEqual([
        'color_undeclared',
        'dpi_missing',
      ])
    })

    it('records an empty Deviation list for a file that departs from nothing', async () => {
      const clean = png({ width: 1800, height: 2400, colorType: 6, totalBytes: 5000, srgbAt: 150 })
      app = await boot(ready({ bytes: 5000 }), { [URL_OK]: teeFile(clean) })
      expect((await ensure(app)).status).toBe(200)
      const row = await stored(app)
      expect(row._tag === 'Success' && row.value?.inspection?.deviations).toEqual([])
    })
  })
})
