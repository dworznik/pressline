import { describe, expect, it } from 'vitest';
import { defaultTemplate, sanitise, toSvg } from '$lib/template';

describe('template', () => {
  it('emits the caption as outlines, never as <text>, so no host font is needed', () => {
    const svg = toSvg({ ...defaultTemplate, text: 'Hello, print' });
    expect(svg).toContain('<path d="M');
    expect(svg).not.toContain('<text');
  });

  it('has no background by default and none in the SVG, so the garment shows through', () => {
    expect(defaultTemplate.background).toBe('none');
    expect(toSvg(defaultTemplate)).not.toContain('<rect width="900" height="1200"');
    expect(toSvg({ ...defaultTemplate, background: '#0a7d5a' })).toContain(
      '<rect width="900" height="1200" fill="#0a7d5a"/>',
    );
  });

  it('keeps a long caption inside the print width by shrinking it', () => {
    const long = toSvg({ ...defaultTemplate, text: 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW' });
    const xs = [...long.matchAll(/<path d="([^"]+)"/g)][0]![1]!
      .match(/-?\d+(\.\d+)?/g)!
      .map(Number);
    const evens = xs.filter((_, i) => i % 2 === 0); // path data alternates x, y for M/L
    expect(Math.min(...evens)).toBeGreaterThanOrEqual(50);
    expect(Math.max(...evens)).toBeLessThanOrEqual(850);
  });

  it('accepts "none" and hex colours for the background, nothing else', () => {
    expect(sanitise({ background: 'none' }).background).toBe('none');
    expect(sanitise({ background: '#123456' }).background).toBe('#123456');
    expect(sanitise({ background: 'red' }).background).toBe('none');
  });
});
