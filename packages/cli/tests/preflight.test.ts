import type { PrintfileSpec } from '@pressline/contract'
import { describe, expect, it } from 'vitest'
import {
  gama,
  iccp,
  jpeg,
  phys,
  pixelsPerMeter,
  png,
  pngWithoutIdat,
  srgb,
  trns,
} from '../../contract/tests/image-bytes.js'
import { formatPreflight, preflight, type PreflightSpec } from '../src/preflight.js'

/**
 * Preflight as an Engine developer meets it: bytes and a Spec in, two tiers
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

const against = (over: Partial<PrintfileSpec> = {}): PreflightSpec => ({
  spec: spec(over),
  specHash: 'a'.repeat(64),
  source: 'tee-black-front/black-m',
})

/** A PNG the way `@pressline/render` writes one: sRGB declared, DPI stamped, IDAT near the top. */
const conformant = (dpi = 150) => png({ colorType: 6 }, srgb, gama, phys(pixelsPerMeter(dpi)), trns)

describe('preflight', () => {
  it('finds nothing to refuse and nothing to report in a file written to the Spec', () => {
    const r = preflight({ path: 'front.png', bytes: conformant() }, against())
    expect(r.invalid).toEqual([])
    expect(r.deviations).toEqual([])
    expect(r.notes).toEqual([])
    expect(r.header).toMatchObject({ format: 'png', width: 1800, height: 2400, alpha: 'present' })
    expect(r.specHash).toBe('a'.repeat(64))
  })

  it('refuses the wrong size in Validation’s own words', () => {
    const bytes = png(
      { colorType: 6, width: 1200, height: 1600 },
      srgb,
      gama,
      phys(pixelsPerMeter(150)),
    )
    const r = preflight({ path: 'small.png', bytes }, against())
    expect(r.invalid).toEqual([
      { reason: 'dimensions', message: 'file is 1200×1600, spec requires 1800×2400' },
    ])
  })

  it('refuses a JPEG where the Spec lists only PNG', () => {
    const r = preflight({ path: 'front.jpg', bytes: jpeg() }, against())
    expect(r.invalid[0]?.reason).toBe('format')
  })

  it('checks only what the file says about itself when there is no Spec', () => {
    const bytes = png({ colorType: 2 }, srgb, gama) // no pHYs: a Deviation with or without a Spec
    const r = preflight({ path: 'front.png', bytes })
    expect(r.invalid).toEqual([])
    expect(r.specHash).toBeUndefined()
    expect(r.deviations.map((d) => d.code)).toEqual(['dpi_missing'])
    expect(formatPreflight([{ result: r }])[0]).toBe(
      'no Spec: dimensions, alpha and DPI not checked',
    )
  })

  it('names the Spec’s DPI in the Deviation when it has one', () => {
    const bytes = png({ colorType: 6 }, srgb, gama, phys(pixelsPerMeter(300)), trns)
    const r = preflight({ path: 'front.png', bytes }, against())
    expect(r.deviations.map((d) => d.code)).toEqual(['dpi_mismatch'])
    expect(r.deviations[0]?.message).toContain('prints at 150 dpi')
  })

  it('refuses bytes that are no image, with a Spec or without one', () => {
    const junk = new TextEncoder().encode('not an image at all, not even close')
    const unreadable = { reason: 'header', message: 'not a readable PNG or JPEG header' }
    expect(preflight({ path: 'notes.txt', bytes: junk }, against()).invalid).toEqual([unreadable])
    expect(preflight({ path: 'notes.txt', bytes: junk }).invalid).toEqual([unreadable])
  })

  it('reads the whole file, and says where the bridge’s 64 KiB view differs', () => {
    // 70 KiB of ICC profile before IDAT: the whole file proves there is no alpha,
    // the window never reaches IDAT and proves nothing.
    const bytes = png({ colorType: 2 }, phys(pixelsPerMeter(150)), iccp(70_000))
    const r = preflight({ path: 'front.png', bytes }, against({ alpha: 'forbidden' }))
    expect(r.header).toMatchObject({ alpha: 'absent', pixelDataOffset: 70_066 })
    expect(r.invalid[0]?.reason).toBe('alpha')
    expect(r.deviations.map((d) => d.code)).toEqual(['header_window'])
    expect(r.notes.join('\n')).toContain(
      'Pressline reads only the first 65536 bytes, which stop before the pixel data: its read sees alpha as unseen where the whole file says absent',
    )
  })

  it('reports an embedded ICC profile and passes no judgment on it', () => {
    const bytes = png(
      { colorType: 6 },
      gama,
      phys(pixelsPerMeter(150)),
      iccp(400, 'Photoshop ICC'),
      trns,
    )
    const r = preflight({ path: 'front.png', bytes }, against())
    expect(r.deviations).toEqual([])
    expect(r.notes[0]).toContain('Photoshop ICC')
    expect(r.notes[0]).toContain('not checked')
  })

  it('says the window holds no header at all when the chunk table never ends', () => {
    const bytes = pngWithoutIdat({ colorType: 6 }, srgb, gama, phys(pixelsPerMeter(150)))
    const r = preflight({ path: 'front.png', bytes }, against())
    expect(r.header).toBeDefined()
    expect(r.invalid).toEqual([])
  })
})

describe('the preflight report', () => {
  it('heads the blocks with the Spec once, gives one block per file, then one summary line', () => {
    const lines = formatPreflight([
      { result: preflight({ path: 'front.png', bytes: conformant() }, against()), spec: against() },
      {
        result: preflight({ path: 'back.png', bytes: png({ colorType: 6 }, trns) }, against()),
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
    expect(lines.at(-1)).toBe('2 files against 1 Spec: 0 refused, 1 with Deviations, 1 clean.')
  })
})
