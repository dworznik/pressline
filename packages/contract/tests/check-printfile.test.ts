import { describe, expect, it } from 'vitest'
import type { PrintfileFacts, PrintfileSpec } from '../src/index'
import { checkPrintfile, HEADER_BYTES, parseImageHeader } from '../src/index'
import { iccp, png, trns } from './image-bytes'

/**
 * The verdict seam (#132): everything Validation refuses, decided from the
 * parsed header, the Spec and what the caller was told. `validatePrintfile`,
 * `printfile check` and Preflight all call this, so they cannot disagree.
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

describe('checkPrintfile: what the Engine declared', () => {
  it('passes a file that matches the Spec and the declaration', () => {
    expect(checkPrintfile(opaque, spec, declared)).toBeUndefined()
  })

  it('refuses a Printfile rendered for another Spec', () => {
    const wrong = checkPrintfile(opaque, spec, {
      ...declared,
      declaredSpecHash: 'b'.repeat(64),
    })
    expect(wrong?.reason).toBe('spec_hash')
  })

  it('refuses a content type the placement does not accept', () => {
    const wrong = checkPrintfile(opaque, spec, {
      ...declared,
      declaredContentType: 'image/jpeg',
    })
    expect(wrong?.reason).toBe('format')
    expect(wrong?.message).toMatch(/image\/jpeg/)
  })

  it('refuses a status that is not 200 or 206, naming the URL', () => {
    const wrong = checkPrintfile(opaque, spec, { ...declared, status: 404 })
    expect(wrong?.reason).toBe('status')
    expect(wrong?.message).toMatch(/https:\/\/engine\.example\/file\.png answered 404/)
  })

  it('refuses a served type that contradicts the declared one', () => {
    const wrong = checkPrintfile(opaque, spec, {
      ...declared,
      servedContentType: 'application/octet-stream',
    })
    expect(wrong?.reason).toBe('content_type')
  })

  it('refuses a size that contradicts the declared one', () => {
    const wrong = checkPrintfile(opaque, spec, { ...declared, servedBytes: 5000 })
    expect(wrong?.reason).toBe('content_length')
  })

  it('refuses dimensions that contradict the declared ones', () => {
    const wrong = checkPrintfile(opaque, spec, { ...declared, declaredWidth: 900 })
    expect(wrong?.reason).toBe('dimensions')
    expect(wrong?.message).toMatch(/900/)
  })
})

describe('checkPrintfile: what the bytes say', () => {
  it('refuses bytes that are not a readable PNG or JPEG header', () => {
    expect(checkPrintfile(undefined, spec, declared)?.reason).toBe('header')
  })

  it('refuses a file whose container is not the declared one', () => {
    const jpegSpec = { ...spec, formats: ['png', 'jpeg'] as const }
    const wrong = checkPrintfile(opaque, jpegSpec, {
      ...declared,
      declaredContentType: 'image/jpeg',
      servedContentType: 'image/jpeg',
    })
    expect(wrong?.reason).toBe('format')
    expect(wrong?.message).toMatch(/file is png/)
  })

  it('refuses dimensions the Spec does not ask for', () => {
    const wrong = checkPrintfile(parseImageHeader(png({ width: 900 })), spec, {
      ...declared,
      declaredWidth: 900,
    })
    expect(wrong?.reason).toBe('dimensions')
    expect(wrong?.message).toMatch(/1800×2400/)
  })
})

describe('checkPrintfile: alpha', () => {
  it('refuses transparency where the placement forbids it', () => {
    const wrong = checkPrintfile(transparent, { ...spec, alpha: 'forbidden' }, declared)
    expect(wrong?.reason).toBe('alpha')
  })

  it('refuses an opaque file where the placement requires transparency', () => {
    const wrong = checkPrintfile(opaque, { ...spec, alpha: 'required' }, declared)
    expect(wrong?.reason).toBe('alpha')
  })

  it('refuses an alpha the header window never saw, on either rule (#117)', () => {
    expect(checkPrintfile(unseen, { ...spec, alpha: 'required' }, declared)?.message).toMatch(
      /could not be seen/,
    )
    expect(checkPrintfile(unseen, { ...spec, alpha: 'forbidden' }, declared)?.message).toMatch(
      /could not be seen/,
    )
  })

  it('accepts any of the three where the placement allows transparency', () => {
    for (const header of [opaque, transparent, unseen]) {
      expect(checkPrintfile(header, spec, declared)).toBeUndefined()
    }
  })
})

describe('checkPrintfile: a caller with no Engine declaration', () => {
  const bare: PrintfileFacts = { url: 'https://cdn.example/art.png', status: 200 }

  it('checks the file against the Spec alone', () => {
    expect(checkPrintfile(opaque, spec, bare)).toBeUndefined()
    expect(checkPrintfile(parseImageHeader(png({ width: 900 })), spec, bare)?.reason).toBe(
      'dimensions',
    )
  })

  it('refuses a container the placement does not accept', () => {
    const wrong = checkPrintfile(opaque, { ...spec, formats: ['jpeg'] }, bare)
    expect(wrong?.reason).toBe('format')
  })

  it('needs no facts at all', () => {
    expect(checkPrintfile(opaque, spec)).toBeUndefined()
    expect(checkPrintfile(transparent, { ...spec, alpha: 'forbidden' })?.reason).toBe('alpha')
  })
})

describe('checkPrintfile: a palette PNG with a tRNS still counts as transparent', () => {
  it('reads alpha from the chunk table, not the color type', () => {
    const header = parseImageHeader(png({}, trns))
    expect(checkPrintfile(header, { ...spec, alpha: 'forbidden' })?.reason).toBe('alpha')
  })
})
