import { parse, type Font } from 'opentype.js';
import dataUri from './fonts/AtkinsonHyperlegible-Bold.ttf?inline';

let cached: Font | undefined;

/**
 * The bundled display face (Atkinson Hyperlegible Bold, SIL OFL 1.1; see
 * `fonts/README.md`). The template turns text into outlines with it, so the
 * same SVG renders identically in the browser, under sharp and under resvg:
 * serverless hosts ship no fonts, and `<text>` there comes out as boxes.
 */
export const displayFont = (): Font => {
  if (cached) return cached;
  const b64 = dataUri.slice(dataUri.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  cached = parse(bytes.buffer);
  return cached;
};
