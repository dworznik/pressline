import { describe, expect, it } from 'vitest'
import type { ImageHeader, PrintfileSpec } from '../src/index'
import { deviations, HEADER_BYTES, parseImageHeader } from '../src/index'
import {
  app0,
  app14,
  filler,
  gama,
  iccp,
  jpeg,
  phys,
  pixelsPerMeter,
  png,
  srgb,
} from './image-bytes'

/**
 * One case per row of the Deviation table (#132), both containers. Every row is
 * a Deviation until #110 promotes it to a rejection, so nothing here asserts a
 * `PrintfileInvalid`.
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

describe('deviations: bit depth is 8', () => {
  it('flags a 16-bit PNG and says what to do', () => {
    expect(codes(png({ bitDepth: 16 }, srgb, phys(pixelsPerMeter(300))))).toContain('bit_depth')
    expect(messageFor(png({ bitDepth: 16 }, srgb, phys(pixelsPerMeter(300))), 'bit_depth')).toMatch(
      /16/,
    )
  })

  it('flags a PNG below 8 bits', () => {
    expect(codes(png({ bitDepth: 4, colorType: 3 }, srgb, phys(pixelsPerMeter(300))))).toContain(
      'bit_depth',
    )
  })

  it('flags a JPEG whose sample precision is not 8', () => {
    expect(codes(jpeg({ precision: 12 }, app0(300)))).toContain('bit_depth')
  })
})

describe('deviations: not interlaced', () => {
  it('flags an interlaced PNG', () => {
    expect(codes(png({ interlace: 1 }, srgb, phys(pixelsPerMeter(300))))).toEqual(['interlaced'])
  })
})

describe('deviations: the color space is declared as sRGB', () => {
  it('flags a PNG with neither an sRGB nor an iCCP chunk', () => {
    expect(codes(png({}, phys(pixelsPerMeter(300))))).toEqual(['color_space'])
  })

  it('accepts an iCCP whose identity it cannot read (#116 decides that row)', () => {
    expect(codes(png({}, iccp(2048, 'Adobe RGB (1998)'), phys(pixelsPerMeter(300))))).toEqual([])
  })

  it('skips the row when the window ended before IDAT', () => {
    const windowed = png({}, iccp(70_000), srgb).subarray(0, HEADER_BYTES)
    expect(codes(windowed)).not.toContain('color_space')
  })

  it('flags a JPEG that is not three-channel', () => {
    expect(codes(jpeg({ components: 1 }, app0(300)))).toEqual(['color_space'])
  })
})

describe('deviations: not CMYK', () => {
  it('flags a four-component JPEG, without repeating itself on the color space row', () => {
    expect(codes(jpeg({ components: 4 }, app0(300)))).toEqual(['cmyk'])
  })

  it('flags an Adobe YCCK transform', () => {
    expect(codes(jpeg({}, app0(300), app14(2)))).toEqual(['cmyk'])
  })

  it('leaves an Adobe YCbCr transform alone', () => {
    expect(codes(jpeg({}, app0(300), app14(1)))).toEqual([])
  })
})

describe('deviations: a DPI stamp is present and equals the Spec', () => {
  it('flags a PNG with no pHYs chunk', () => {
    expect(codes(png({}, srgb))).toEqual(['dpi_missing'])
  })

  it('flags a pHYs in no physical unit', () => {
    expect(codes(png({}, srgb, phys(3, 4, 0)))).toEqual(['dpi_missing'])
  })

  it('flags a PNG stamped at the wrong dpi', () => {
    expect(codes(png({}, srgb, phys(pixelsPerMeter(150))))).toEqual(['dpi_mismatch'])
    expect(messageFor(png({}, srgb, phys(pixelsPerMeter(150))), 'dpi_mismatch')).toMatch(/150.*300/)
  })

  it('flags an axis that disagrees with the other', () => {
    expect(codes(png({}, srgb, phys(pixelsPerMeter(300), pixelsPerMeter(150))))).toEqual([
      'dpi_mismatch',
    ])
  })

  it('skips the equality row without a Spec, and keeps the presence row', () => {
    expect(codesWithoutSpec(png({}, srgb, phys(pixelsPerMeter(150))))).toEqual([])
    expect(codesWithoutSpec(png({}, srgb))).toEqual(['dpi_missing'])
  })

  it('skips both rows when the window ended before IDAT', () => {
    const windowed = png({}, iccp(70_000), srgb).subarray(0, HEADER_BYTES)
    expect(codes(windowed)).toEqual([])
  })

  it('flags a JPEG with no JFIF density', () => {
    expect(codes(jpeg())).toEqual(['dpi_missing'])
  })

  it('flags a JFIF density in dots per centimeter, equivalent or not', () => {
    expect(codes(jpeg({}, app0(118, 118, 2)))).toEqual(['dpi_mismatch'])
    expect(codes(jpeg({}, app0(1, 1, 0)))).toEqual(['dpi_missing'])
  })

  it('flags a JPEG stamped at the wrong dpi', () => {
    expect(codes(jpeg({}, app0(72)))).toEqual(['dpi_mismatch'])
  })
})

describe('deviations: the chunk table ends inside the header window', () => {
  it('flags a PNG whose IDAT starts past the window', () => {
    const far = png({}, srgb, phys(pixelsPerMeter(300)), iccp(70_000))
    expect(codes(far)).toEqual(['header_window'])
    expect(messageFor(far, 'header_window')).toMatch(/64 KiB/)
  })

  it('flags a JPEG whose frame header starts past the window', () => {
    expect(codes(jpeg({}, app0(300), filler(70_000)))).toEqual(['header_window'])
  })

  it('says nothing when the window itself cut the read short', () => {
    const windowed = png({}, srgb, phys(pixelsPerMeter(300)), iccp(70_000)).subarray(
      0,
      HEADER_BYTES,
    )
    expect(codes(windowed)).toEqual([])
  })
})
