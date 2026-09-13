import { describe, expect, it } from 'vitest'
import {
  describeHeader,
  formatInspection,
  inspectionFails,
  parseImageHeader,
  PrintfileInvalid,
  type Inspection,
} from '../src/index'
import { app0, jpeg, phys, pixelsPerMeter, png, srgb } from './image-bytes'

/**
 * The one block `pressline engine preflight`, `pressline printfile check` and
 * `pressline engine conformance` print, and the one rule all three exit by.
 * They cannot disagree about a file because there is nothing to disagree with:
 * the text and the verdict are here, once.
 */
const refusal = (reason: 'alpha' | 'dimensions', message: string) =>
  new PrintfileInvalid({ reason, message })

const clean: Inspection = { invalid: [], deviations: [] }
const deviating: Inspection = {
  invalid: [],
  deviations: [{ code: 'dpi_missing', message: 'the file carries no pHYs chunk' }],
}
const refused: Inspection = {
  invalid: [refusal('dimensions', 'file is 900×1200, spec requires 1800×2400')],
  deviations: [{ code: 'dpi_missing', message: 'the file carries no pHYs chunk' }],
}

describe('formatInspection', () => {
  it('marks each refusal ✗ and each Deviation ⚠, indented under whatever named the file', () => {
    expect(formatInspection(refused)).toEqual([
      '  ✗ dimensions: file is 900×1200, spec requires 1800×2400',
      '  ⚠ dpi_missing: the file carries no pHYs chunk',
    ])
  })

  it('says a clean file is clean, unless the caller already printed its own ✓', () => {
    expect(formatInspection(clean)).toEqual(['  ✓ nothing Validation would refuse'])
    expect(formatInspection(clean, { affirmClean: false })).toEqual([])
    // The affirmation is the only thing that option touches.
    expect(formatInspection(deviating, { affirmClean: false })).toEqual([
      '  ⚠ dpi_missing: the file carries no pHYs chunk',
    ])
  })

  it('prints a code it has never heard of, so an old CLI reads a new instance', () => {
    // The published vocabulary grows; a printer that refused to print an unknown
    // code would turn one new rule into a broken command everywhere.
    expect(
      formatInspection({
        invalid: [{ reason: 'invented_later', message: 'something new' }],
        deviations: [{ code: 'also_new', message: 'something else' }],
      }),
    ).toEqual(['  ✗ invented_later: something new', '  ⚠ also_new: something else'])
  })
})

describe('inspectionFails: the shared exit rule', () => {
  it('fails on a refusal, always', () => {
    expect(inspectionFails(refused)).toBe(true)
    expect(inspectionFails(refused, true)).toBe(true)
  })

  it('passes a Deviation, and fails it only under strictness', () => {
    expect(inspectionFails(deviating)).toBe(false)
    expect(inspectionFails(deviating, true)).toBe(true)
  })

  it('passes a clean file either way', () => {
    expect(inspectionFails(clean)).toBe(false)
    expect(inspectionFails(clean, true)).toBe(false)
  })
})

describe('describeHeader', () => {
  it('says what a PNG says about itself, in one line', () => {
    expect(describeHeader(parseImageHeader(png({}, srgb, phys(pixelsPerMeter(150))))!)).toBe(
      'png 1800×2400, 8-bit color type 2, alpha absent, 150×150 dpi',
    )
    expect(describeHeader(parseImageHeader(png({ bitDepth: 16, interlace: 1 }, srgb))!)).toBe(
      'png 1800×2400, 16-bit color type 2, interlaced, alpha absent, no DPI stamped',
    )
  })

  it('says what a JPEG says about itself', () => {
    expect(describeHeader(parseImageHeader(jpeg({ components: 4 }, app0(300)))!)).toBe(
      'jpeg 1800×2400, 8-bit, 4 channel(s), alpha absent, 300×300 dpi',
    )
  })

  it('reports an aspect-only stamp as the non-resolution it is', () => {
    expect(describeHeader(parseImageHeader(png({}, phys(3, 4, 0)))!)).toContain(
      '3:4 aspect only, no DPI',
    )
  })
})
