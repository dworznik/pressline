/**
 * The deterministic template designer (ticket #22): a few knobs → one SVG.
 * Pure, so the browser preview and the server's Printfile come from the
 * same function. 3:4 portrait, 900×1200 user units: a t-shirt front at
 * 12×16 in. Text is emitted as outlines from the bundled font (`font.ts`),
 * never as `<text>`, so no host font is ever needed.
 */
import type { Font } from 'opentype.js';
import { displayFont } from './font';

export interface Template {
  readonly text: string;
  readonly textColor: string;
  /** A hex colour, or `none` for a transparent background: the garment shows through. */
  readonly background: string;
  readonly shape: 'circle' | 'square' | 'triangle' | 'none';
  readonly shapeColor: string;
}

export const WIDTH = 900;
export const HEIGHT = 1200;
export const ASPECT = { w: 3, h: 4 } as const;

/** Sized for a tee: one graphic in the upper two thirds, a caption under it, nothing behind. */
export const defaultTemplate: Template = {
  text: 'Hello, print',
  textColor: '#1d1d1f',
  background: 'none',
  shape: 'circle',
  shapeColor: '#ffd166',
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const colour = (c: string, fallback: string) => (HEX.test(c) ? c : fallback);

/** Clamp free input into something the SVG can hold. */
export const sanitise = (t: Partial<Template>): Template => ({
  text: (t.text ?? defaultTemplate.text).slice(0, 40),
  textColor: colour(t.textColor ?? '', defaultTemplate.textColor),
  background: t.background === 'none' ? 'none' : colour(t.background ?? '', 'none'),
  shape: (['circle', 'square', 'triangle', 'none'] as const).includes(t.shape as never)
    ? (t.shape as Template['shape'])
    : 'circle',
  shapeColor: colour(t.shapeColor ?? '', defaultTemplate.shapeColor),
});

// Composition: the shape sits in a 600-unit box centred at (450, 470), the
// caption's baseline is at 900. At 150 dpi on the tee that is an 8 in graphic
// with the caption just under it, which reads as one print on the garment.
const CX = 450;
const CY = 470;
const HALF = 300;

const shapeMarkup = (t: Template) => {
  switch (t.shape) {
    case 'circle':
      return `<circle cx="${CX}" cy="${CY}" r="${HALF}" fill="${t.shapeColor}"/>`;
    case 'square':
      return `<rect x="${CX - HALF}" y="${CY - HALF}" width="${HALF * 2}" height="${HALF * 2}" rx="48" fill="${t.shapeColor}"/>`;
    case 'triangle':
      return `<polygon points="${CX},${CY - HALF} ${CX + HALF},${CY + HALF} ${CX - HALF},${CY + HALF}" fill="${t.shapeColor}"/>`;
    case 'none':
      return '';
  }
};

const TEXT_SIZE = 104;
const TEXT_MAX_WIDTH = 780;
const TEXT_BASELINE = 900;

/** The caption as a filled path: centred, shrunk to fit the width when long. */
const textMarkup = (t: Template, font: Font) => {
  if (!t.text.trim()) return '';
  const natural = font.getAdvanceWidth(t.text, TEXT_SIZE);
  const size = natural > TEXT_MAX_WIDTH ? (TEXT_SIZE * TEXT_MAX_WIDTH) / natural : TEXT_SIZE;
  const width = font.getAdvanceWidth(t.text, size);
  const d = font.getPath(t.text, CX - width / 2, TEXT_BASELINE, size).toPathData(2);
  return `<path d="${d}" fill="${t.textColor}"/>`;
};

export const toSvg = (input: Partial<Template>, font: Font = displayFont()): string => {
  const t = sanitise(input);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
    t.background === 'none'
      ? ''
      : `<rect width="${WIDTH}" height="${HEIGHT}" fill="${t.background}"/>`,
    shapeMarkup(t),
    textMarkup(t, font),
    `</svg>`,
  ].join('');
};
