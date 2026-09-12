import type { PrintfileSpec } from '@pressline/contract'
import { describe, expect, it } from 'vitest'
import { fitsBudget, rawBytesFor, render, RenderRefused } from '../src/index.js'
import { backends, blueJpeg, greenSvg, header, pixel, redLeft, wasmBackend } from './support.js'

/**
 * Seam 3 (docs/SPEC.md): the render helper is judged by the PNG it writes,
 * the way Pressline judges an Engine's Printfile: header dimensions, DPI,
 * color type and alpha. One suite, both backends.
 */
const spec = (over: Partial<PrintfileSpec> = {}): PrintfileSpec => ({
  width: 120,
  height: 160,
  dpi: 300,
  formats: ['png'],
  colorSpace: 'srgb',
  alpha: 'allowed',
  placement: 'front',
  technique: 'dtg',
  ...over,
})

describe.each(backends)('render on the %s backend', (_name, make) => {
  it('contains a raster into the Spec: exact size, DPI, sRGB, RGBA with the transparent margin', async () => {
    const backend = await make()
    const png = await render(backend, { kind: 'raster', bytes: await redLeft() }, spec())
    const h = header(png)
    expect(h).toMatchObject({
      width: 120,
      height: 160,
      bitDepth: 8,
      colorType: 6,
      dpi: 300,
      srgb: true,
    })
    // 40×20 into 120×160 (contain): scaled to 120×60, centered vertically at y=50..110.
    expect(await pixel(png, 30, 80)).toEqual([255, 0, 0, 255]) // left half: red
    expect(await pixel(png, 90, 80)).toEqual([0, 0, 0, 0]) // right half: transparent
    expect(await pixel(png, 60, 10)).toEqual([0, 0, 0, 0]) // letterbox: transparent
  })

  it('flattens onto a background and writes RGB when the Spec forbids alpha', async () => {
    const backend = await make()
    const png = await render(
      backend,
      { kind: 'raster', bytes: await redLeft() },
      spec({ alpha: 'forbidden', formats: ['png', 'jpeg'] }),
      { background: { r: 10, g: 20, b: 30 } },
    )
    const h = header(png)
    expect(h).toMatchObject({ width: 120, height: 160, colorType: 2, hasTrns: false })
    expect(await pixel(png, 90, 80)).toEqual([10, 20, 30, 255])
    expect(await pixel(png, 60, 10)).toEqual([10, 20, 30, 255])
    expect(await pixel(png, 30, 80)).toEqual([255, 0, 0, 255])
  })

  it('covers: fills the Spec and crops, honoring alignment', async () => {
    const backend = await make()
    // 30×60 blue JPEG into 120×160: cover scales to 120×240, top-aligned → no letterbox anywhere.
    const png = await render(backend, { kind: 'raster', bytes: await blueJpeg() }, spec(), {
      fit: 'cover',
      align: { y: 'top' },
    })
    expect(header(png)).toMatchObject({ width: 120, height: 160, colorType: 6 })
    const [r, g, b, a] = await pixel(png, 60, 159)
    expect(a).toBe(255)
    expect(b).toBeGreaterThan(200)
    expect(r + g).toBeLessThan(40)
  })

  it('aligns a contained image to a corner', async () => {
    const backend = await make()
    const png = await render(backend, { kind: 'raster', bytes: await redLeft() }, spec(), {
      align: { x: 'left', y: 'bottom' },
    })
    expect(await pixel(png, 5, 155)).toEqual([255, 0, 0, 255])
    expect(await pixel(png, 5, 5)).toEqual([0, 0, 0, 0])
  })

  it('rasterises SVG at the Spec resolution', async () => {
    const backend = await make()
    const png = await render(backend, { kind: 'svg', svg: greenSvg }, spec({ dpi: 150 }))
    const h = header(png)
    expect(h).toMatchObject({ width: 120, height: 160, dpi: 150 })
    // 100×50 into 120×160: 120×60, centered at y=50..110.
    expect(await pixel(png, 60, 80)).toEqual([0, 255, 0, 255])
    expect(await pixel(png, 60, 20)).toEqual([0, 0, 0, 0])
  })

  it('refuses a Spec that forbids the only format it writes, and alpha rules it cannot meet', async () => {
    const backend = await make()
    const input = { kind: 'raster' as const, bytes: await redLeft() }
    await expect(render(backend, input, spec({ formats: ['jpeg'] }))).rejects.toMatchObject({
      _tag: 'RenderRefused',
      reason: 'format',
    })
    await expect(
      render(backend, input, spec({ alpha: 'required' }), { background: { r: 0, g: 0, b: 0 } }),
    ).rejects.toMatchObject({ reason: 'alpha' })
    await expect(
      render(backend, input, spec({ alpha: 'forbidden' }), { background: 'transparent' }),
    ).rejects.toMatchObject({ reason: 'alpha' })
  })
})

describe('WASM byte budget', () => {
  it('is knowable up front and refused with numbers, before any decoding', async () => {
    const backend = await wasmBackend(1024 * 1024)
    const big = spec({ width: 1000, height: 1000 })
    expect(rawBytesFor(big)).toBe(1000 * 1000 * 4 * 4)
    expect(fitsBudget(big, backend)).toEqual({
      ok: false,
      required: 16_000_000,
      budget: 1_048_576,
    })
    expect(fitsBudget(spec(), backend)).toEqual({ ok: true })
    const err = await render(backend, { kind: 'raster', bytes: new Uint8Array(0) }, big).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(RenderRefused)
    expect((err as RenderRefused).reason).toBe('budget')
    expect((err as RenderRefused).detail).toEqual({ required: 16_000_000, budget: 1_048_576 })
    // A small Spec with a huge source is refused from the header alone, before decoding.
    const hugeHeader = new Uint8Array(24)
    hugeHeader.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    new DataView(hugeHeader.buffer).setUint32(16, 6000)
    new DataView(hugeHeader.buffer).setUint32(20, 6000)
    const fromSource = await render(backend, { kind: 'raster', bytes: hugeHeader }, spec()).catch(
      (e: unknown) => e,
    )
    expect((fromSource as RenderRefused).reason).toBe('budget')
    expect((fromSource as RenderRefused).detail.required).toBe(6000 * 6000 * 4 + 120 * 160 * 4 * 3)
  })

  it('does not bind the Node backend', () => {
    expect(fitsBudget(spec({ width: 20000, height: 20000 }), {})).toEqual({ ok: true })
  })
})
