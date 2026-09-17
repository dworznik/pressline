import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import type { PrintfileFacts, PrintfileSpec } from '../src/index'
import {
  checkPrintfile,
  HEADER_BYTES,
  inspectImageHeader,
  MAX_PRINTFILE_BYTES,
  parseImageHeader,
} from '../src/index'
import { app0, app2, app14, iccp, iccpWith, jpeg, png, srgb, text, trns } from './image-bytes'

/**
 * The verdict seam (#132, #87): everything Validation refuses about one file,
 * decided from the parsed header, the Spec and what the caller was told.
 * `validatePrintfile`, `printfile check` and Preflight all call this, so they
 * cannot disagree.
 */
const spec: PrintfileSpec = {
  width: 1800,
  height: 2400,
  dpi: 300,
  formats: ['png'],
  colorSpace: 'srgb',
  alpha: 'allowed',
  placement: 'front',
  technique: 'dtg',
}

const opaque = parseImageHeader(png())!
const transparent = parseImageHeader(png({ colorType: 6 }))!
/** A window that ended before IDAT: transparency neither proved nor disproved (#117). */
const unseen = parseImageHeader(png({}, iccp(70_000)).subarray(0, HEADER_BYTES))!

/** The header as Validation reads it: parsed, then the bounded iCCP inflate. */
const inspect = (bytes: Uint8Array) => Effect.runPromise(inspectImageHeader(bytes))

const declared: PrintfileFacts = {
  url: 'https://engine.example/file.png',
  status: 206,
  servedContentType: 'image/png',
  servedBytes: 4096,
  declaredContentType: 'image/png',
  declaredBytes: 4096,
  declaredWidth: 1800,
  declaredHeight: 2400,
  declaredSpecHash: 'a'.repeat(64),
  expectedSpecHash: 'a'.repeat(64),
}

const reasons = (...args: Parameters<typeof checkPrintfile>) =>
  checkPrintfile(...args).map((p) => p.reason)
const first = (...args: Parameters<typeof checkPrintfile>) => checkPrintfile(...args)[0]

describe('checkPrintfile: what the Engine declared', () => {
  it('passes a file that matches the Spec and the declaration', () => {
    expect(checkPrintfile(opaque, spec, declared)).toEqual([])
  })

  it('refuses a Printfile rendered for another Spec', () => {
    expect(reasons(opaque, spec, { ...declared, declaredSpecHash: 'b'.repeat(64) })).toEqual([
      'spec_hash',
    ])
  })

  it('refuses a content type the placement does not accept', () => {
    const wrong = first(opaque, spec, { ...declared, declaredContentType: 'image/jpeg' })
    expect(wrong?.reason).toBe('format')
    expect(wrong?.message).toMatch(/image\/jpeg/)
  })

  it('refuses a status that is not 200 or 206, naming the URL, and says nothing else about the file', () => {
    const wrong = checkPrintfile(undefined, spec, { ...declared, status: 404 })
    expect(wrong.map((p) => p.reason)).toEqual(['status'])
    expect(wrong[0]?.message).toMatch(/https:\/\/engine\.example\/file\.png answered 404/)
  })

  it('refuses a served type that contradicts the declared one', () => {
    expect(
      reasons(opaque, spec, { ...declared, servedContentType: 'application/octet-stream' }),
    ).toEqual(['content_type'])
  })

  it('refuses a size that contradicts the declared one', () => {
    expect(reasons(opaque, spec, { ...declared, servedBytes: 5000 })).toEqual(['content_length'])
  })

  it('refuses dimensions that contradict the declared ones', () => {
    const wrong = first(opaque, spec, { ...declared, declaredWidth: 900 })
    expect(wrong?.reason).toBe('dimensions')
    expect(wrong?.message).toMatch(/900/)
  })
})

describe('checkPrintfile: what the bytes say', () => {
  it('refuses bytes that are not a readable PNG or JPEG header', () => {
    expect(reasons(undefined, spec, declared)).toEqual(['header'])
  })

  it('refuses a file whose container is not the declared one', () => {
    const jpegSpec = { ...spec, formats: ['png', 'jpeg'] as const }
    const wrong = first(opaque, jpegSpec, {
      ...declared,
      declaredContentType: 'image/jpeg',
      servedContentType: 'image/jpeg',
    })
    expect(wrong?.reason).toBe('format')
    expect(wrong?.message).toMatch(/file is png/)
  })

  it('refuses dimensions the Spec does not ask for', () => {
    const wrong = first(parseImageHeader(png({ width: 900 })), spec, {
      ...declared,
      declaredWidth: 900,
    })
    expect(wrong?.reason).toBe('dimensions')
    expect(wrong?.message).toMatch(/1800×2400/)
  })
})

describe('checkPrintfile: alpha', () => {
  it('refuses transparency where the placement forbids it', () => {
    expect(reasons(transparent, { ...spec, alpha: 'forbidden' }, declared)).toEqual(['alpha'])
  })

  it('refuses an opaque file where the placement requires transparency', () => {
    expect(reasons(opaque, { ...spec, alpha: 'required' }, declared)).toEqual(['alpha'])
  })

  it('refuses an alpha the header window never saw, on either rule (#117)', () => {
    expect(first(unseen, { ...spec, alpha: 'required' }, declared)?.message).toMatch(
      /could not be seen/,
    )
    expect(first(unseen, { ...spec, alpha: 'forbidden' }, declared)?.message).toMatch(
      /could not be seen/,
    )
  })

  it('accepts any of the three where the placement allows transparency', () => {
    for (const header of [opaque, transparent, unseen]) {
      expect(checkPrintfile(header, spec, declared)).toEqual([])
    }
  })
})

describe('checkPrintfile: a caller with no Engine declaration', () => {
  const bare: PrintfileFacts = { url: 'https://cdn.example/art.png', status: 200 }

  it('checks the file against the Spec alone', () => {
    expect(checkPrintfile(opaque, spec, bare)).toEqual([])
    expect(reasons(parseImageHeader(png({ width: 900 })), spec, bare)).toEqual(['dimensions'])
  })

  it('refuses a container the placement does not accept', () => {
    expect(reasons(opaque, { ...spec, formats: ['jpeg'] }, bare)).toEqual(['format'])
  })

  it('needs no facts at all', () => {
    expect(checkPrintfile(opaque, spec)).toEqual([])
    expect(reasons(transparent, { ...spec, alpha: 'forbidden' })).toEqual(['alpha'])
  })
})

describe('checkPrintfile: a palette PNG with a tRNS still counts as transparent', () => {
  it('reads alpha from the chunk table, not the color type', () => {
    const header = parseImageHeader(png({}, trns))
    expect(reasons(header, { ...spec, alpha: 'forbidden' })).toEqual(['alpha'])
  })
})

// ---- the rejection table (#87 §1) ------------------------------------------

describe('checkPrintfile: bit depth is 8', () => {
  it('refuses a 16-bit PNG and says what to write instead', () => {
    const wrong = first(parseImageHeader(png({ bitDepth: 16 }, srgb)), spec)
    expect(wrong?.reason).toBe('bit_depth')
    expect(wrong?.message).toMatch(/16-bit depth; Printfiles are 8 bits per channel/)
  })

  it('refuses a 12-bit JPEG', () => {
    const jpegSpec = { ...spec, formats: ['jpeg'] as const, alpha: 'forbidden' as const }
    const wrong = first(parseImageHeader(jpeg({ precision: 12 })), jpegSpec)
    expect(wrong?.reason).toBe('bit_depth')
    expect(wrong?.message).toMatch(/12-bit samples/)
  })
})

describe('checkPrintfile: color type', () => {
  it('refuses a palette PNG on color_type, not on bit_depth, when the depth is 8', () => {
    const refusals = checkPrintfile(
      parseImageHeader(png({ colorType: 3, bitDepth: 8 }, srgb)),
      spec,
    )
    expect(refusals.map((p) => p.reason)).toEqual(['color_type'])
    expect(refusals[0]?.message).toMatch(/palette-indexed \(color type 3\).*256 colors/)
  })

  it('accepts grayscale: the file prints, and the Deviation says it prints gray', () => {
    for (const colorType of [0, 4]) {
      expect(checkPrintfile(parseImageHeader(png({ colorType }, srgb)), spec)).toEqual([])
    }
    expect(
      checkPrintfile(parseImageHeader(jpeg({ components: 1 })), {
        ...spec,
        formats: ['jpeg'],
        alpha: 'forbidden',
      }),
    ).toEqual([])
  })
})

describe('checkPrintfile: not interlaced', () => {
  it('refuses an Adam7 PNG', () => {
    const wrong = first(parseImageHeader(png({ interlace: 1 }, srgb)), spec)
    expect(wrong?.reason).toBe('interlaced')
    expect(wrong?.message).toMatch(/interlaced \(Adam7\)/)
  })
})

describe('checkPrintfile: the color space a profile declares', () => {
  const jpegSpec = { ...spec, formats: ['jpeg'] as const, alpha: 'forbidden' as const }

  it('refuses a PNG whose profile declares CMYK, naming the profile', async () => {
    const header = await inspect(png({}, iccpWith('CMYK', { name: 'US Web Coated' })))
    const wrong = first(header, spec)
    expect(wrong?.reason).toBe('color_space')
    expect(wrong?.message).toBe(
      'the embedded profile "US Web Coated" declares a CMYK color space; Printfiles are sRGB, and a PNG may not carry a CMYK profile',
    )
  })

  it('refuses a PNG whose profile declares a gray space', async () => {
    const header = await inspect(png({}, iccpWith('GRAY', { name: 'Dot Gain 20%' })))
    expect(first(header, spec)?.message).toMatch(/declares a grayscale color space/)
  })

  it('leaves an RGB profile alone: which RGB it is is out of scope (#116)', async () => {
    const header = await inspect(png({}, iccpWith('RGB ', { name: 'Adobe RGB (1998)' })))
    expect(checkPrintfile(header, spec)).toEqual([])
  })

  it('never refuses a profile it could not read', async () => {
    for (const chunkBytes of [
      iccp(400), // zeros where a deflate stream belongs
      iccpWith('CMYK', { acsp: false }), // inflates, but is no ICC profile
      iccpWith('CMYK', { prefixBytes: 2 }), // too little of the stream to produce a header
    ]) {
      expect(checkPrintfile(await inspect(png({}, chunkBytes)), spec)).toEqual([])
    }
  })

  it('never reads a JPEG’s APP2 profile: the frame header already proves the channels', async () => {
    // A three-channel JPEG carrying a CMYK profile in APP2 is not refused, and
    // the profile is not even parsed — only PNG's iCCP is ever inflated.
    const bytes = jpeg({}, app0(300), app2('CMYK'))
    const header = await inspect(bytes)
    expect(header).not.toHaveProperty('iccProfile')
    expect(checkPrintfile(header, jpegSpec)).toEqual([])
  })

  it('refuses a four-channel JPEG and an Adobe YCCK transform', () => {
    expect(first(parseImageHeader(jpeg({ components: 4 })), jpegSpec)?.message).toBe(
      'the JPEG has four channels, so it is CMYK or YCCK; Printfiles are sRGB',
    )
    const ycck = first(parseImageHeader(jpeg({}, app14(2))), jpegSpec)
    expect(ycck?.reason).toBe('color_space')
    expect(ycck?.message).toMatch(/Adobe YCCK transform/)
    // A YCbCr transform is what an ordinary three-channel JPEG declares.
    expect(checkPrintfile(parseImageHeader(jpeg({}, app14(1))), jpegSpec)).toEqual([])
  })
})

describe('checkPrintfile: the provider’s size ceiling', () => {
  const big = (bytes: number): PrintfileFacts => ({
    ...declared,
    servedBytes: bytes,
    declaredBytes: bytes,
  })

  it('refuses a file over 200 000 000 bytes and states the size in MB', () => {
    const wrong = first(opaque, spec, big(213_000_000))
    expect(wrong?.reason).toBe('too_large')
    expect(wrong?.message).toBe(
      'the file is 213 MB; the fulfillment provider refuses anything over 200 MB',
    )
  })

  it('accepts the bound itself, and refuses one byte past it', () => {
    expect(checkPrintfile(opaque, spec, big(MAX_PRINTFILE_BYTES))).toEqual([])
    expect(reasons(opaque, spec, big(MAX_PRINTFILE_BYTES + 1))).toEqual(['too_large'])
  })

  it('believes a declaration the host never confirmed', () => {
    expect(reasons(opaque, spec, { declaredBytes: 300_000_000 })).toEqual(['too_large'])
  })

  it('never states a size that reads as the bound it just broke', () => {
    // Rounded to the nearest MB this read "the file is 200 MB; ... refuses
    // anything over 200 MB", which tells an Engine developer nothing to act on.
    const wrong = first(opaque, spec, big(200_200_000))
    expect(wrong?.reason).toBe('too_large')
    expect(wrong?.message).toBe(
      'the file is 200.2 MB; the fulfillment provider refuses anything over 200 MB',
    )
  })
})

describe('checkPrintfile: a file that breaks several rules', () => {
  it('returns every refusal, in table order', () => {
    const bytes = png({ bitDepth: 16, colorType: 3, interlace: 1, width: 900 }, srgb)
    expect(reasons(parseImageHeader(bytes), spec)).toEqual([
      'dimensions',
      'bit_depth',
      'color_type',
      'interlaced',
    ])
  })

  it('puts a refused profile after the IHDR rules and before alpha', async () => {
    const bytes = png({ bitDepth: 16, colorType: 6 }, iccpWith('CMYK'), trns)
    expect(reasons(await inspect(bytes), { ...spec, alpha: 'forbidden' })).toEqual([
      'bit_depth',
      'color_space',
      'alpha',
    ])
  })
})

describe('checkPrintfile: a chunk table that outruns the window', () => {
  it('leaves the profile unseen rather than refusing it', async () => {
    // The iCCP chunk starts 20 bytes before the window ends: its name is inside, its profile is not.
    const bytes = png({}, text(HEADER_BYTES - 65), iccpWith('CMYK')).subarray(0, HEADER_BYTES)
    const header = await inspect(bytes)
    expect(header?.format === 'png' && header.iccProfile?.colorSpace).toBe('unseen')
    expect(checkPrintfile(header, spec)).toEqual([])
  })
})
