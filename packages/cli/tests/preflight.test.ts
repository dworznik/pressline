import type { PrintfileSpec } from '@pressline/contract'
import { describe, expect, it } from 'vitest'
import {
  gama,
  iccp,
  iccpWith,
  jpeg,
  phys,
  pixelsPerMeter,
  png,
  pngWithoutIdat,
  srgb,
  trns,
} from '../../contract/tests/image-bytes.js'
import { formatPreflight, preflight, type NamedSpec } from '../src/preflight.js'

/**
 * Preflight as an Engine developer meets it: bytes and a Spec in, an Inspection
 * out — what Validation would refuse, and what the file merely departs from.
 * The verdicts belong to `@pressline/contract`; what is asserted here is that
 * Preflight asks it the right questions about a whole file on disk.
 */
const spec = (over: Partial<PrintfileSpec> = {}): PrintfileSpec => ({
  width: 1800,
  height: 2400,
  dpi: 150,
  formats: ['png'],
  colorSpace: 'srgb',
  alpha: 'allowed',
  placement: 'front',
  technique: 'dtg',
  ...over,
})

const against = (over: Partial<PrintfileSpec> = {}): NamedSpec => ({
  spec: spec(over),
  specHash: 'a'.repeat(64),
  source: 'tee-black-front/black-m',
})

/** The Promise form an Engine's own test suite uses, which is the point of it. */
const look = (file: { path: string; bytes: Uint8Array }, named?: NamedSpec) =>
  preflight(file, named)

const reasons = (result: { invalid: readonly { reason: string }[] }) =>
  result.invalid.map((p) => p.reason)
const codes = (result: { deviations: readonly { code: string }[] }) =>
  result.deviations.map((d) => d.code)

/** A PNG the way `@pressline/render` writes one: sRGB declared, DPI stamped, IDAT near the top. */
const conformant = (dpi = 150) => png({ colorType: 6 }, srgb, gama, phys(pixelsPerMeter(dpi)), trns)

describe('preflight', () => {
  it('finds nothing to refuse and nothing to report in a file written to the Spec', async () => {
    const r = await look({ path: 'front.png', bytes: conformant() }, against())
    expect(r.invalid).toEqual([])
    expect(r.deviations).toEqual([])
    expect(r.notes).toEqual([])
    expect(r.header).toMatchObject({ format: 'png', width: 1800, height: 2400, alpha: 'present' })
    expect(r.specHash).toBe('a'.repeat(64))
  })

  it('refuses the wrong size in Validation’s own words', async () => {
    const bytes = png(
      { colorType: 6, width: 1200, height: 1600 },
      srgb,
      gama,
      phys(pixelsPerMeter(150)),
    )
    const r = await look({ path: 'small.png', bytes }, against())
    expect(reasons(r)).toEqual(['dimensions'])
    expect(r.invalid[0]?.message).toBe('file is 1200×1600, spec requires 1800×2400')
  })

  it('refuses a JPEG where the Spec lists only PNG', async () => {
    expect(reasons(await look({ path: 'front.jpg', bytes: jpeg() }, against()))).toEqual(['format'])
  })

  it('returns every refusal at once, so one round of fixes is enough', async () => {
    const bytes = png({ colorType: 3, bitDepth: 16, interlace: 1 }, srgb, phys(pixelsPerMeter(150)))
    expect(reasons(await look({ path: 'bad.png', bytes }, against()))).toEqual([
      'bit_depth',
      'color_type',
      'interlaced',
    ])
  })

  it('checks only what the file says about itself when there is no Spec', async () => {
    const bytes = png({ colorType: 2 }, srgb, gama) // no pHYs: a Deviation with or without a Spec
    const r = await look({ path: 'front.png', bytes })
    expect(r.invalid).toEqual([])
    expect(r.specHash).toBeUndefined()
    expect(codes(r)).toEqual(['dpi_missing'])
    expect(formatPreflight([{ result: r }])[0]).toBe(
      'no Spec: dimensions, alpha and DPI not checked',
    )
  })

  it('names the Spec’s DPI in the Deviation when it has one', async () => {
    const bytes = png({ colorType: 6 }, srgb, gama, phys(pixelsPerMeter(300)), trns)
    const r = await look({ path: 'front.png', bytes }, against())
    expect(codes(r)).toEqual(['dpi_mismatch'])
    expect(r.deviations[0]?.message).toContain('prints at 150 dpi')
  })

  it('refuses bytes that are no image, with a Spec or without one', async () => {
    const junk = new TextEncoder().encode('not an image at all, not even close')
    for (const named of [against(), undefined]) {
      const r = await look({ path: 'notes.txt', bytes: junk }, named)
      expect(reasons(r)).toEqual(['header'])
      expect(r.invalid[0]?.message).toBe('not a readable PNG or JPEG header')
    }
  })

  it('reads the whole file, and says where the bridge’s 64 KiB view differs', async () => {
    // 70 KiB of ICC profile before IDAT: the whole file proves there is no alpha,
    // the window never reaches IDAT and proves nothing.
    const bytes = png({ colorType: 2 }, phys(pixelsPerMeter(150)), iccp(70_000))
    const r = await look({ path: 'front.png', bytes }, against({ alpha: 'forbidden' }))
    expect(r.header).toMatchObject({ alpha: 'absent', pixelDataOffset: 70_066 })
    expect(reasons(r)).toEqual(['alpha'])
    expect(codes(r)).toEqual(['icc_unseen', 'header_window'])
    expect(r.notes.find((n) => n.code === 'header_window')?.message).toBe(
      'Pressline reads only the first 65536 bytes, which stop before the pixel data: its read sees alpha as unseen where the whole file says absent',
    )
  })

  it('reports an RGB profile as a fact and passes no judgment on which RGB it is', async () => {
    const bytes = png(
      { colorType: 6 },
      gama,
      phys(pixelsPerMeter(150)),
      iccpWith('RGB ', { name: 'Photoshop ICC' }),
      trns,
    )
    const r = await look({ path: 'front.png', bytes }, against())
    expect(r.deviations).toEqual([])
    expect(r.notes[0]?.code).toBe('icc_profile')
    expect(r.notes[0]?.message).toContain('Photoshop ICC')
    expect(r.notes[0]?.message).toContain('which RGB is not checked')
  })

  it('leaves the note off a profile a refusal or a Deviation already names', async () => {
    const with_ = (chunk: Uint8Array) =>
      png({ colorType: 6 }, srgb, phys(pixelsPerMeter(150)), chunk, trns)

    const cmyk = await look({ path: 'cmyk.png', bytes: with_(iccpWith('CMYK')) }, against())
    expect(reasons(cmyk)).toEqual(['color_space'])
    expect(cmyk.notes).toEqual([])

    const unreadable = await look({ path: 'unread.png', bytes: with_(iccp(400)) }, against())
    expect(codes(unreadable)).toEqual(['icc_unseen'])
    expect(unreadable.notes).toEqual([])
  })

  it('says the window holds no header at all when the chunk table never ends', async () => {
    const bytes = pngWithoutIdat({ colorType: 6 }, srgb, gama, phys(pixelsPerMeter(150)))
    const r = await look({ path: 'front.png', bytes }, against())
    expect(r.header).toBeDefined()
    expect(r.invalid).toEqual([])
  })
})

describe('the preflight report', () => {
  it('heads the blocks with the Spec once, gives one block per file, then one summary line', async () => {
    const lines = formatPreflight([
      {
        result: await look({ path: 'front.png', bytes: conformant() }, against()),
        spec: against(),
      },
      {
        result: await look({ path: 'back.png', bytes: png({ colorType: 6 }, trns) }, against()),
        spec: against(),
      },
    ])
    expect(lines[0]).toBe(
      'Spec tee-black-front/black-m: 1800×2400px @ 150 dpi, png, alpha allowed (hash aaaaaaaaaaaa…)',
    )
    expect(lines[1]).toMatch(
      /^File front\.png: png 1800×2400, 8-bit color type 6, alpha present, 150×150 dpi, \d+ bytes$/,
    )
    expect(lines[2]).toBe('  ✓ nothing Validation would refuse')
    // One Spec, two files: the Spec line heads the report, it does not repeat.
    expect(lines.filter((l) => l.startsWith('Spec'))).toHaveLength(1)
    expect(lines[3]).toMatch(/^File back\.png: /)
    expect(lines.at(-1)).toBe('2 files × 1 Spec: 0 refused, 1 with Deviations, 1 clean.')
  })
})
