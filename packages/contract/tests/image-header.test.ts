import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { HEADER_BYTES, inspectImageHeader, parseImageHeader } from '../src/index'
import {
  app0,
  app14,
  chunk,
  filler,
  concat,
  gama,
  gamaWith,
  iccp,
  iccpWith,
  ihdr,
  jpeg,
  phys,
  pixelsPerMeter,
  plte,
  png,
  pngWithoutIdat,
  SIGNATURE,
  srgb,
  text,
  trns,
} from './image-bytes'

describe('parseImageHeader: PNG alpha is present, absent or unseen', () => {
  it('reports absent once IDAT is reached without a tRNS', () => {
    expect(parseImageHeader(png())).toMatchObject({
      format: 'png',
      width: 1800,
      height: 2400,
      alpha: 'absent',
    })
  })

  it('reports present from the color type alone', () => {
    expect(parseImageHeader(png({ colorType: 6 }))?.alpha).toBe('present')
    expect(parseImageHeader(png({ colorType: 4 }))?.alpha).toBe('present')
  })

  it('reports present from a tRNS chunk on a palette or RGB image', () => {
    expect(parseImageHeader(png({ colorType: 3 }, plte, trns))?.alpha).toBe('present')
    expect(parseImageHeader(png({}, trns))?.alpha).toBe('present')
  })

  it('reports unseen when the chunk table runs past the window before IDAT (#117)', () => {
    const file = png({}, iccp(70_000), trns)
    expect(parseImageHeader(file)?.alpha).toBe('present')
    expect(parseImageHeader(file.subarray(0, HEADER_BYTES))?.alpha).toBe('unseen')
    // The same window on an opaque file is just as inconclusive.
    expect(parseImageHeader(png({}, iccp(70_000)).subarray(0, HEADER_BYTES))?.alpha).toBe('unseen')
  })

  it('still sees a tRNS whose data straddles the window boundary', () => {
    // 8 signature + 25 IHDR + (12 + n) iCCP puts the tRNS header at HEADER_BYTES - 8.
    const file = png({}, iccp(HEADER_BYTES - 8 - 8 - 25 - 12), trns)
    expect(parseImageHeader(file.subarray(0, HEADER_BYTES))?.alpha).toBe('present')
  })

  it('still sees an IDAT whose data straddles the window boundary', () => {
    const file = png({}, iccp(HEADER_BYTES - 8 - 8 - 25 - 12))
    expect(parseImageHeader(file.subarray(0, HEADER_BYTES))?.alpha).toBe('absent')
  })
})

describe('parseImageHeader: PNG chunk plausibility', () => {
  it('refuses an IHDR whose length is not 13', () => {
    const file = concat([SIGNATURE, chunk('IHDR', ihdr(), 14), chunk('IDAT', new Uint8Array(16))])
    expect(parseImageHeader(file)).toBeUndefined()
  })

  it('refuses a chunk whose type is not four ASCII letters', () => {
    const withNul = new Uint8Array([0x69, 0x00, 0x43, 0x50]) // "i", NUL, "C", "P"
    expect(parseImageHeader(png({}, chunk(withNul, new Uint8Array(4))))).toBeUndefined()
    expect(parseImageHeader(png({}, chunk('1234', new Uint8Array(4))))).toBeUndefined()
  })

  it('refuses a chunk whose declared length exceeds 2^31 - 1', () => {
    expect(parseImageHeader(png({}, chunk('iCCP', new Uint8Array(4), 0x80000000)))).toBeUndefined()
  })
})

describe('parseImageHeader: what else the PNG header says (#132)', () => {
  it('reports bit depth, color type and the interlace flag', () => {
    expect(parseImageHeader(png({ bitDepth: 16, colorType: 6 }))).toMatchObject({
      bitDepth: 16,
      colorType: 6,
      interlaced: false,
    })
    expect(parseImageHeader(png({ interlace: 1 }))?.format === 'png').toBe(true)
    const interlaced = parseImageHeader(png({ interlace: 1 }))
    expect(interlaced?.format === 'png' && interlaced.interlaced).toBe(true)
  })

  it('lists the chunk types seen between IHDR and IDAT, in file order', () => {
    const header = parseImageHeader(png({}, srgb, gama, phys(11811)))
    expect(header?.format === 'png' && header.chunks).toEqual(['sRGB', 'gAMA', 'pHYs'])
  })

  it('stops the chunk list where the window stops', () => {
    const file = png({}, iccp(70_000), srgb)
    const header = parseImageHeader(file.subarray(0, HEADER_BYTES))
    expect(header?.format === 'png' && header.chunks).toEqual(['iCCP'])
  })

  it('reads pHYs back as dpi on both axes', () => {
    const header = parseImageHeader(png({}, phys(pixelsPerMeter(300), pixelsPerMeter(150))))
    expect(header?.density).toEqual({
      x: pixelsPerMeter(300),
      y: pixelsPerMeter(150),
      unit: 'meter',
      dpiX: 300,
      dpiY: 150,
    })
  })

  it('reports a pHYs in no physical unit without a dpi', () => {
    const header = parseImageHeader(png({}, phys(3, 4, 0)))
    expect(header?.density).toEqual({ x: 3, y: 4, unit: 'aspect' })
  })

  it('reports the iCCP profile name, size and offset, and leaves its space unseen', () => {
    const header = parseImageHeader(png({}, iccp(2048, 'Adobe RGB (1998)')))
    expect(header?.format === 'png' && header.iccProfile).toEqual({
      name: 'Adobe RGB (1998)',
      compressedBytes: 2048 - 'Adobe RGB (1998)'.length - 2,
      offset: 8 + 25 + 8,
      // A bare parse never inflates; what the profile declares is inspectImageHeader's business.
      colorSpace: 'unseen',
    })
  })

  it('reads gAMA back as the value the chunk holds', () => {
    expect(parseImageHeader(png({}, gama))?.format === 'png').toBe(true)
    const header = parseImageHeader(png({}, gamaWith(100_000)))
    expect(header?.format === 'png' && header.gamma).toBe(100_000)
    expect(parseImageHeader(png())?.format === 'png' && parseImageHeader(png())).not.toHaveProperty(
      'gamma',
    )
  })

  it('reports the byte offset of the first IDAT, and omits it when unseen', () => {
    expect(parseImageHeader(png())?.pixelDataOffset).toBe(8 + 12 + 13)
    expect(parseImageHeader(png({}, iccp(70_000)))?.pixelDataOffset).toBe(8 + 25 + 12 + 70_000)
    const windowed = parseImageHeader(png({}, iccp(70_000)).subarray(0, HEADER_BYTES))
    expect(windowed?.pixelDataOffset).toBeUndefined()
  })

  it('reads a file whose chunk table never ends', () => {
    const header = parseImageHeader(pngWithoutIdat({}, srgb))
    expect(header).toMatchObject({ format: 'png', alpha: 'unseen' })
    expect(header?.pixelDataOffset).toBeUndefined()
  })
})

describe('parseImageHeader: JPEG', () => {
  it('reads SOF0 and reports alpha absent', () => {
    expect(parseImageHeader(jpeg())).toMatchObject({
      format: 'jpeg',
      width: 1800,
      height: 2400,
      alpha: 'absent',
    })
  })

  it('tolerates 0xFF fill bytes before a marker', () => {
    const short = new Uint8Array([0xff, 0xe0, 0x00, 0x04, 0, 0])
    expect(
      parseImageHeader(jpeg({}, new Uint8Array([0xff, 0xff, 0xff]), short, new Uint8Array([0xff])))
        ?.width,
    ).toBe(1800)
  })

  it('refuses a stuffed 0xFF00 outside entropy-coded data', () => {
    expect(parseImageHeader(jpeg({}, new Uint8Array([0xff, 0x00])))).toBeUndefined()
  })

  it('refuses a scan or end-of-image before any frame header', () => {
    expect(parseImageHeader(jpeg({}, new Uint8Array([0xff, 0xda, 0x00, 0x02])))).toBeUndefined()
    expect(parseImageHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeUndefined()
  })
})

describe('parseImageHeader: what else the JPEG header says (#132)', () => {
  it('reports sample precision and the component count', () => {
    expect(parseImageHeader(jpeg({ precision: 12, components: 4 }))).toMatchObject({
      precision: 12,
      components: 4,
    })
  })

  it('reports the Adobe APP14 transform when the segment is there', () => {
    const header = parseImageHeader(jpeg({ components: 4 }, app14(2)))
    expect(header?.format === 'jpeg' && header.adobeTransform).toBe(2)
    const plain = parseImageHeader(jpeg())
    expect(plain?.format === 'jpeg' && plain.adobeTransform).toBeUndefined()
  })

  it('reads the transform from its fixed offset, not the end of a padded segment', () => {
    const padded = parseImageHeader(jpeg({}, app14(1, 6)))
    expect(padded?.format === 'jpeg' && padded.adobeTransform).toBe(1)
  })

  it('reads the JFIF density as dpi, per unit', () => {
    expect(parseImageHeader(jpeg({}, app0(300, 150)))?.density).toEqual({
      x: 300,
      y: 150,
      unit: 'inch',
      dpiX: 300,
      dpiY: 150,
    })
    expect(parseImageHeader(jpeg({}, app0(118, 118, 2)))?.density).toEqual({
      x: 118,
      y: 118,
      unit: 'centimeter',
      dpiX: 300,
      dpiY: 300,
    })
    expect(parseImageHeader(jpeg({}, app0(1, 1, 0)))?.density).toEqual({
      x: 1,
      y: 1,
      unit: 'aspect',
    })
  })

  it('reports the byte offset of the SOF', () => {
    expect(parseImageHeader(jpeg())?.pixelDataOffset).toBe(2)
    const far = filler(70_000)
    expect(parseImageHeader(jpeg({}, far))?.pixelDataOffset).toBe(2 + far.length)
  })

  it('reads a progressive frame header too', () => {
    expect(parseImageHeader(jpeg({ marker: 0xc2 }))).toMatchObject({ format: 'jpeg', width: 1800 })
  })
})

describe('inspectImageHeader: the bounded iCCP inflate (#116, ADR-0002 as amended)', () => {
  const inspect = (bytes: Uint8Array) => Effect.runPromise(inspectImageHeader(bytes))
  const spaceOf = async (bytes: Uint8Array) => {
    const header = await inspect(bytes)
    return header?.format === 'png' ? header.iccProfile?.colorSpace : undefined
  }

  it('reads the data color space out of the profile header', async () => {
    expect(await spaceOf(png({}, iccpWith('RGB ')))).toBe('rgb')
    expect(await spaceOf(png({}, iccpWith('CMYK')))).toBe('cmyk')
    expect(await spaceOf(png({}, iccpWith('GRAY')))).toBe('gray')
    expect(await spaceOf(png({}, iccpWith('Lab ')))).toBe('other')
  })

  it('reads it out of a prefix, without the profile ever ending', async () => {
    // A profile far larger than the 512 compressed bytes the inflater is fed:
    // the header is at the front, so a prefix is all it takes.
    const bytes = png({}, iccpWith('CMYK', { name: 'sRGB v4 preference' }), srgb)
    expect(await spaceOf(bytes)).toBe('cmyk')
  })

  it('collapses every way of failing to one unseen, and never to a refusal', async () => {
    // zeros where the deflate stream belongs
    expect(await spaceOf(png({}, iccp(400)))).toBe('unseen')
    // inflates, but the bytes are not an ICC profile
    expect(await spaceOf(png({}, iccpWith('CMYK', { acsp: false })))).toBe('unseen')
    // two bytes of zlib header produce no output at all
    expect(await spaceOf(png({}, iccpWith('CMYK', { prefixBytes: 2 })))).toBe('unseen')
    // the chunk starts inside the window and its profile lies past it
    const straddling = png({}, text(HEADER_BYTES - 65), iccpWith('CMYK')).subarray(0, HEADER_BYTES)
    expect(await spaceOf(straddling)).toBe('unseen')
  })

  it('reads no profile byte past the window, whole file or ranged read', async () => {
    // Preflight hands this the whole file and Validation hands it 64 KiB. If the
    // bound were the buffer's length rather than the window, the same profile
    // would be `cmyk` locally and `unseen` at sale — one file, two Inspections,
    // which is the thing an Inspection may never be (ADR-0002 as amended).
    const file = png({}, text(HEADER_BYTES - 65), iccpWith('CMYK'))
    expect(file.length).toBeGreaterThan(HEADER_BYTES)
    expect(await spaceOf(file)).toBe('unseen')
    expect(await spaceOf(file.subarray(0, HEADER_BYTES))).toBe('unseen')
  })

  it('leaves a compression method PNG does not define unread', async () => {
    const bytes = png({}, iccpWith('CMYK'))
    // The method byte follows the name and its NUL: signature 8 + IHDR 25 + chunk header 8 + name + NUL.
    bytes[8 + 25 + 8 + 'ICC Profile'.length + 1] = 1
    expect(await spaceOf(bytes)).toBe('unseen')
  })

  it('hands back exactly what the parser produced when there is no profile to read', async () => {
    expect(await inspect(png({}, srgb))).toEqual(parseImageHeader(png({}, srgb)))
    expect(await inspect(jpeg())).toEqual(parseImageHeader(jpeg()))
    expect(await inspect(new Uint8Array(8))).toBeUndefined()
  })
})
