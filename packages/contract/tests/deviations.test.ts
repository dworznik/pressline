import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import type { ImageHeader, PrintfileSpec } from '../src/index'
import { deviations, HEADER_BYTES, inspectImageHeader, parseImageHeader } from '../src/index'
import {
  app0,
  filler,
  gama,
  gamaWith,
  iccp,
  iccpWith,
  jpeg,
  phys,
  pixelsPerMeter,
  png,
  srgb,
  text,
} from './image-bytes'

/**
 * One case per Deviation row of the table in #87 §1, both containers. A
 * Deviation never blocks a sale, so nothing here asserts a refusal; what is
 * refused is `check-printfile.test.ts`.
 */
const spec: PrintfileSpec = {
  width: 1800,
  height: 2400,
  dpi: 300,
  formats: ['png', 'jpeg'],
  colorSpace: 'srgb',
  alpha: 'allowed',
  placement: 'front',
  technique: 'dtg',
}

const header = (bytes: Uint8Array): ImageHeader => {
  const parsed = parseImageHeader(bytes)
  if (!parsed) throw new Error('the test built bytes the parser cannot read')
  return parsed
}

const codes = (bytes: Uint8Array) => deviations(header(bytes), spec).map((d) => d.code)

/** The rows a caller with no Spec in hand can still settle. */
const codesWithoutSpec = (bytes: Uint8Array) => deviations(header(bytes)).map((d) => d.code)

const messageFor = (bytes: Uint8Array, code: string) =>
  deviations(header(bytes), spec).find((d) => d.code === code)?.message ?? ''

/** Deviations as Validation finds them: after the bounded iCCP inflate has run. */
const inspectedCodes = async (bytes: Uint8Array) => {
  const inspected = await Effect.runPromise(inspectImageHeader(bytes))
  if (!inspected) throw new Error('the test built bytes the parser cannot read')
  return deviations(inspected, spec).map((d) => d.code)
}

/** Everything the protocol asks for: 8-bit, not interlaced, sRGB, the Spec's dpi. */
const conformingPng = (...extra: Uint8Array[]) =>
  png({}, srgb, gama, phys(pixelsPerMeter(300)), ...extra)

const conformingJpeg = (...extra: Uint8Array[]) => jpeg({}, app0(300), ...extra)

describe('deviations: a conforming file has none', () => {
  it('finds nothing in a PNG that meets every row', () => {
    expect(codes(conformingPng())).toEqual([])
  })

  it('finds nothing in a JPEG that meets every row', () => {
    expect(codes(conformingJpeg())).toEqual([])
  })
})

describe('deviations: color type', () => {
  it('reports a grayscale PNG, which prints as gray', () => {
    expect(codes(png({ colorType: 0 }, srgb, phys(pixelsPerMeter(300))))).toEqual(['color_type'])
    expect(messageFor(png({ colorType: 4 }, srgb, phys(pixelsPerMeter(300))), 'color_type')).toBe(
      'the PNG is grayscale (color type 4); Printfiles are RGB, and a grayscale file prints as one',
    )
  })

  it('reports a single-channel JPEG', () => {
    expect(codes(jpeg({ components: 1 }, app0(300)))).toEqual(['color_type'])
  })

  it('says nothing about a four-channel JPEG, which is refused instead', () => {
    expect(codes(jpeg({ components: 4 }, app0(300)))).toEqual([])
  })

  it('says nothing about a palette PNG, which is refused instead', () => {
    expect(codes(png({ colorType: 3 }, srgb, phys(pixelsPerMeter(300))))).toEqual([])
  })
})

describe('deviations: the color space is declared', () => {
  it('reports a PNG with no sRGB, gAMA or iCCP chunk', () => {
    expect(codes(png({}, phys(pixelsPerMeter(300))))).toEqual(['color_undeclared'])
  })

  it('takes any of the three chunks as a declaration', () => {
    for (const chunk of [srgb, gama, iccp(400)]) {
      expect(codes(png({}, chunk, phys(pixelsPerMeter(300))))).not.toContain('color_undeclared')
    }
  })

  it('skips the row when the window ended before IDAT: absence proves nothing', () => {
    const windowed = png({}, iccp(70_000)).subarray(0, HEADER_BYTES)
    expect(codes(windowed)).not.toContain('color_undeclared')
  })
})

describe('deviations: gamma', () => {
  it('reports a gamma far from sRGB when it is the sole declaration', () => {
    expect(codes(png({}, gamaWith(100_000), phys(pixelsPerMeter(300))))).toEqual(['gamma'])
    expect(messageFor(png({}, gamaWith(100_000), phys(pixelsPerMeter(300))), 'gamma')).toBe(
      'the PNG declares gamma 1/1 with no sRGB chunk or profile; write gAMA 45455 (sRGB), or declare the space',
    )
  })

  it('says nothing when sRGB or a profile is present: they take precedence', () => {
    expect(codes(png({}, srgb, gamaWith(100_000), phys(pixelsPerMeter(300))))).toEqual([])
    expect(codes(png({}, iccp(400), gamaWith(100_000), phys(pixelsPerMeter(300))))).not.toContain(
      'gamma',
    )
  })

  it('accepts the sRGB gamma, however an encoder rounded it', () => {
    for (const value of [45_455, 45_000, 45_456]) {
      expect(codes(png({}, gamaWith(value), phys(pixelsPerMeter(300))))).toEqual([])
    }
  })
})

describe('deviations: an ICC profile nobody could read', () => {
  it('reports a profile the bounded inflate could not identify, and never more than that', async () => {
    const bytes = png({}, iccp(400, 'Photoshop ICC'), phys(pixelsPerMeter(300)))
    expect(await inspectedCodes(bytes)).toEqual(['icc_unseen'])
    expect(messageFor(bytes, 'icc_unseen')).toBe(
      'the PNG embeds an ICC profile named "Photoshop ICC" that Pressline could not read within its 64 KiB window; which color space it declares is unknown',
    )
  })

  it('says nothing once the profile has been read, whatever it declares', async () => {
    for (const space of ['RGB ', 'CMYK', 'GRAY']) {
      const bytes = png({}, iccpWith(space), phys(pixelsPerMeter(300)))
      expect(await inspectedCodes(bytes)).toEqual([])
    }
  })

  it('reports a profile whose chunk straddles the window', async () => {
    const bytes = png({}, text(HEADER_BYTES - 65), iccpWith('CMYK')).subarray(0, HEADER_BYTES)
    expect(await inspectedCodes(bytes)).toContain('icc_unseen')
  })
})

describe('deviations: a DPI stamp is present and equals the Spec', () => {
  it('reports a PNG with no pHYs chunk', () => {
    expect(codes(png({}, srgb))).toEqual(['dpi_missing'])
  })

  it('reports a pHYs in no physical unit', () => {
    expect(codes(png({}, srgb, phys(3, 4, 0)))).toEqual(['dpi_missing'])
  })

  it('reports a PNG stamped at the wrong dpi, and names the upscale', () => {
    expect(codes(png({}, srgb, phys(pixelsPerMeter(72))))).toEqual(['dpi_mismatch'])
    expect(messageFor(png({}, srgb, phys(pixelsPerMeter(72))), 'dpi_mismatch')).toBe(
      'the file is stamped 72×72 dpi; this placement prints at 300 dpi, and a provider reading that stamp may silently upscale the file',
    )
  })

  it('reports an axis that disagrees with the other', () => {
    expect(codes(png({}, srgb, phys(pixelsPerMeter(300), pixelsPerMeter(150))))).toEqual([
      'dpi_mismatch',
    ])
  })

  it('skips the equality row without a Spec, and keeps the presence row', () => {
    expect(codesWithoutSpec(png({}, srgb, phys(pixelsPerMeter(150))))).toEqual([])
    expect(codesWithoutSpec(png({}, srgb))).toEqual(['dpi_missing'])
  })

  it('skips both rows when the window ended before IDAT', () => {
    const windowed = png({}, srgb, iccp(70_000)).subarray(0, HEADER_BYTES)
    expect(codes(windowed)).toEqual(['icc_unseen']) // the profile is the only thing left to say
  })

  it('reports a JPEG with no JFIF density', () => {
    expect(codes(jpeg())).toEqual(['dpi_missing'])
  })

  it('reports a JFIF density in dots per centimeter, equivalent or not', () => {
    expect(codes(jpeg({}, app0(118, 118, 2)))).toEqual(['dpi_mismatch'])
    expect(codes(jpeg({}, app0(1, 1, 0)))).toEqual(['dpi_missing'])
  })

  it('reports a JPEG stamped at the wrong dpi', () => {
    expect(codes(jpeg({}, app0(72)))).toEqual(['dpi_mismatch'])
  })
})

describe('deviations: the chunk table ends inside the header window', () => {
  it('reports a PNG whose IDAT starts past the window', () => {
    const far = png({}, srgb, phys(pixelsPerMeter(300)), iccp(70_000))
    expect(codes(far)).toEqual(['icc_unseen', 'header_window'])
    expect(messageFor(far, 'header_window')).toMatch(/64 KiB/)
  })

  it('reports a JPEG whose frame header starts past the window', () => {
    expect(codes(jpeg({}, app0(300), filler(70_000)))).toEqual(['header_window'])
  })

  it('reports an IDAT that starts inside the window but ends past it', () => {
    // signature 8 + IHDR 25 + sRGB 13 + pHYs 21 + the iCCP chunk's own 12 = 79 bytes of
    // table before the profile, so the filler decides where IDAT lands.
    const idatAt = (offset: number) => png({}, srgb, phys(pixelsPerMeter(300)), iccp(offset - 79))
    const straddling = idatAt(HEADER_BYTES - 4)
    expect(header(straddling).pixelDataOffset).toBe(HEADER_BYTES - 4)
    // A chunk header is 8 bytes; one that runs past the end leaves the read as blind.
    expect(codes(straddling)).toEqual(['icc_unseen', 'header_window'])
    const inside = idatAt(HEADER_BYTES - 8)
    expect(header(inside).pixelDataOffset).toBe(HEADER_BYTES - 8)
    expect(codes(inside)).toEqual(['icc_unseen'])
  })

  it('says nothing when the window itself cut the read short', () => {
    const windowed = png({}, srgb, phys(pixelsPerMeter(300)), iccp(70_000)).subarray(
      0,
      HEADER_BYTES,
    )
    expect(codes(windowed)).toEqual(['icc_unseen'])
  })
})
