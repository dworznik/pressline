import { describe, expect, it } from 'vitest'
import { defaultTemplate, sanitize, toSvg } from '$lib/template'

describe('template', () => {
  it('emits the caption as outlines, never as <text>, so no host font is needed', () => {
    const svg = toSvg({ ...defaultTemplate, text: 'Hello, print' })
    expect(svg).toContain('<path d="M')
    expect(svg).not.toContain('<text')
  })

  it('has no background by default and none in the SVG, so the garment shows through', () => {
    expect(defaultTemplate.background).toBe('none')
    expect(toSvg(defaultTemplate)).not.toContain('<rect width="900" height="1200"')
    expect(toSvg({ ...defaultTemplate, background: '#0a7d5a' })).toContain(
      '<rect width="900" height="1200" fill="#0a7d5a"/>',
    )
  })

  it('keeps a long caption inside the print width by shrinking it', () => {
    const long = toSvg({ ...defaultTemplate, text: 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW' })
    const xs = [...long.matchAll(/<path d="([^"]+)"/g)][0]![1]!.match(/-?\d+(\.\d+)?/g)!.map(Number)
    const evens = xs.filter((_, i) => i % 2 === 0) // path data alternates x, y for M/L
    expect(Math.min(...evens)).toBeGreaterThanOrEqual(50)
    expect(Math.max(...evens)).toBeLessThanOrEqual(850)
  })

  it('writes a well-formed path for every caption: no NaN, whatever the centering lands on', () => {
    // opentype's own `toPathData` writes the literal `NaN` when a coordinate
    // prints in exponential notation, which a fractional x-origin easily
    // produces. "Level one" is one such caption: it used to render as "L".
    const captions = [
      'Level one',
      'Levelone',
      'Hello, print',
      'Summer camp 2026',
      'A B',
      'iiii',
      'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
    ]
    for (const text of captions) {
      const svg = toSvg({ ...defaultTemplate, text })
      const d = /<path d="([^"]*)"/.exec(svg)?.[1] ?? ''
      expect(d, text).not.toContain('NaN')
      expect(d, text).not.toMatch(/[eE][-+]\d/) // no exponential notation either
      expect(d, text).toMatch(/^[MLCQZ0-9 .,-]+$/) // only path syntax
      expect(d.length, text).toBeGreaterThan(0)
    }
  })

  it('accepts "none" and hex colors for the background, nothing else', () => {
    expect(sanitize({ background: 'none' }).background).toBe('none')
    expect(sanitize({ background: '#123456' }).background).toBe('#123456')
    expect(sanitize({ background: 'red' }).background).toBe('none')
  })
})
