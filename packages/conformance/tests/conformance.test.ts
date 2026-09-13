import type { DesignResponse } from '@pressline/contract'
import { Redacted } from 'effect'
import { describe, expect, it } from 'vitest'
import { conformance, conformanceOptions, formatReport } from '../src/index.js'
import { fakeEngine } from './fake-engine.js'

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
}
const run = (fetch: typeof globalThis.fetch) =>
  conformance({ baseUrl: 'https://engine.test', secret: 's3cret', designId: design.id, fetch })
const names = (r: Awaited<ReturnType<typeof run>>) =>
  Object.fromEntries(r.checks.map((c) => [c.name, c.ok]))

describe('conformance suite', () => {
  it('passes a well-behaved Engine that renders at once', async () => {
    const report = await run(fakeEngine({ design }).fetch)
    expect(report.ok, formatReport(report)).toBe(true)
    expect(names(report)).toEqual({
      health: true,
      design: true,
      preview: true,
      render: true,
      idempotent: true,
      printfile: true,
      rejects: true,
    })
    expect(formatReport(report)).toMatch(/✓ render {6}answered 200 ready at once/)
    expect(formatReport(report)).toMatch(
      /✓ printfile {3}https:\/\/engine\.test\/files\/heron-0001\/[0-9a-f]{8}\.png: png 1200×1600, 8-bit color type 6, alpha present, 150×150 dpi, \d+ bytes/,
    )
    expect(formatReport(report)).toMatch(/Conformant\.$/)
    expect(report.deviations).toBe(0)
  })

  it('passes an Engine that answers 202 and then 200', async () => {
    const report = await run(fakeEngine({ design, renderingTimes: 2 }).fetch)
    expect(report.ok).toBe(true)
    expect(report.checks.find((c) => c.name === 'render')?.detail).toBe(
      'answered 202 (retry after 300 ms), then 200 ready',
    )
  })

  it('names each broken rule: hash echo, file size, idempotency, impossible Spec, preview, version', async () => {
    const wrongHash = await run(fakeEngine({ design, wrongHash: true }).fetch)
    expect(wrongHash.ok).toBe(false)
    const hashCheck = wrongHash.checks.find((c) => c.name === 'printfile')
    expect(hashCheck?.ok).toBe(false)
    expect(hashCheck?.inspection?.invalid[0]?.reason).toBe('spec_hash')

    const wrongSize = await run(fakeEngine({ design, fileSize: { width: 600, height: 800 } }).fetch)
    const sizeCheck = wrongSize.checks.find((c) => c.name === 'printfile')
    expect(sizeCheck?.inspection?.invalid[0]?.message).toBe(
      'file is 600×800, spec requires 1200×1600',
    )
    expect(formatReport(wrongSize)).toContain(
      '  ✗ dimensions: file is 600×800, spec requires 1200×1600',
    )

    const fresh = await run(fakeEngine({ design, freshUrls: true }).fetch)
    expect(fresh.checks.find((c) => c.name === 'idempotent')).toMatchObject({ ok: false })
    expect(fresh.checks.find((c) => c.name === 'printfile')?.ok).toBe(true)

    const lenient = await run(fakeEngine({ design, acceptsAnything: true }).fetch)
    expect(lenient.checks.find((c) => c.name === 'rejects')?.detail).toBe(
      'answered ready to a 4000×40 Spec instead of 422 PrintfileRejected',
    )

    const noPreview = await run(fakeEngine({ design, previewStatus: 404 }).fetch)
    expect(noPreview.checks.find((c) => c.name === 'preview')?.detail).toContain('HTTP 404')

    const old = await run(fakeEngine({ design, protocolVersion: '0' }).fetch)
    expect(old.checks.find((c) => c.name === 'health')?.detail).toBe(
      'protocol version 0, this suite speaks 1',
    )
    expect(formatReport(old)).toMatch(/1 check\(s\) failed\.$/)
  })

  it('fails an Engine that answers with another Design, and one that never finishes rendering', async () => {
    const wrongId = await run(fakeEngine({ design, wrongId: true }).fetch)
    expect(wrongId.checks.at(-1)).toMatchObject({
      name: 'design',
      ok: false,
      detail: 'answered with Design "other-design-0001" for /designs/heron-0001',
    })

    const forever = await conformance({
      baseUrl: 'https://engine.test',
      secret: 's3cret',
      designId: design.id,
      fetch: fakeEngine({ design, renderingTimes: 1000 }).fetch,
      renderTimeout: '800 millis',
    })
    expect(forever.ok).toBe(false)
    expect(names(forever)).toMatchObject({
      render: false,
      idempotent: true,
      printfile: true,
      rejects: true,
    })
    expect(forever.checks.find((c) => c.name === 'render')?.detail).toBe(
      'still rendering after 800ms',
    )
    expect(forever.checks.find((c) => c.name === 'idempotent')?.detail).toBe(
      'skipped: no Printfile to repeat',
    )
  })

  it('accepts a file host that ignores Range, and an Engine that renders any shape when told so', async () => {
    const plain = await run(fakeEngine({ design, ignoresRange: true }).fetch)
    expect(plain.ok, formatReport(plain)).toBe(true)

    const anyShape = await conformance({
      baseUrl: 'https://engine.test',
      secret: 's3cret',
      designId: design.id,
      fetch: fakeEngine({ design, acceptsAnything: true }).fetch,
      impossibleSpec: false,
    })
    expect(anyShape.ok).toBe(true)
    expect(anyShape.checks.at(-1)?.detail).toBe('skipped: this Engine renders any shape')
  })

  it('stops early when the Engine does not answer at all', async () => {
    const report = await conformance({
      baseUrl: 'https://engine.test',
      secret: 's',
      designId: 'x',
      fetch: async () => new Response('', { status: 500 }),
    })
    expect(report.ok).toBe(false)
    expect(report.checks).toHaveLength(1)
    expect(report.checks[0]?.name).toBe('health')
  })

  it('calls a deviating Engine conformant, and says how far it deviates', async () => {
    const report = await run(fakeEngine({ design, bareHeader: true }).fetch)
    expect(report.ok).toBe(true)
    expect(report.deviations).toBe(2)
    const printed = formatReport(report)
    expect(printed).toContain('  ⚠ color_undeclared: the PNG declares no color space')
    expect(printed).toContain('  ⚠ dpi_missing: the file carries no pHYs chunk')
    expect(printed).toMatch(/Conformant, with 2 Deviations\.$/)
  })

  it('fails the same Engine under strict, on the Deviations alone', async () => {
    const report = await conformance({
      baseUrl: 'https://engine.test',
      secret: 's3cret',
      designId: design.id,
      fetch: fakeEngine({ design, bareHeader: true }).fetch,
      strict: true,
    })
    expect(report.ok).toBe(false)
    expect(names(report)).toMatchObject({ printfile: false })
    // Nothing Validation would refuse: the check fails on the Deviations alone.
    expect(report.checks.find((c) => c.name === 'printfile')?.inspection?.invalid).toEqual([])
    expect(formatReport(report)).toMatch(/1 check\(s\) failed\.$/)
  })

  it('asks for a JPEG-only, alpha-forbidden Spec when told to, and refuses the same shape', async () => {
    const engine = fakeEngine({ design })
    const report = await conformance({
      baseUrl: 'https://engine.test',
      secret: 's3cret',
      designId: design.id,
      fetch: engine.fetch,
      format: 'jpeg',
    })
    expect(report.ok, formatReport(report)).toBe(true)
    expect(report.checks.find((c) => c.name === 'printfile')?.detail).toMatch(
      /\.jpg: jpeg 1200×1600, 8-bit, 3 channel\(s\), alpha absent, 150×150 dpi/,
    )
    // The impossible Spec follows the same shape, so its 422 is about the aspect.
    expect(report.checks.find((c) => c.name === 'rejects')?.detail).toMatch(/422 aspect_mismatch/)
  })

  it('refuses an insecure base URL before touching the network', async () => {
    await expect(
      conformance({ baseUrl: 'http://engine.example', secret: 's', designId: 'x' }),
    ).rejects.toSatisfy((e: unknown) => String(e).includes('InsecureEngineBaseUrl'))
  })
})

describe('the command-line surface', () => {
  /** `pressline engine conformance` and the alias binary share these; they must not drift. */
  const flags = {
    baseUrl: 'https://engine.example',
    secret: Redacted.make('s3cret'),
    design: 'heron-0001',
    dpi: 300,
    timeout: 90,
    anyShape: false,
    format: 'jpeg' as const,
    strict: true,
    json: true,
  }

  it('hands every flag to the suite, and keeps --json for the printer', () => {
    const options = conformanceOptions(flags)
    expect(options).toMatchObject({
      baseUrl: 'https://engine.example',
      secret: 's3cret',
      designId: 'heron-0001',
      dpi: 300,
      format: 'jpeg',
      strict: true,
    })
    // --json decides how the report is printed, not how it is produced.
    expect(options).not.toHaveProperty('json')
    expect(options).not.toHaveProperty('impossibleSpec')
    expect(conformanceOptions({ ...flags, anyShape: true }).impossibleSpec).toBe(false)
  })
})
