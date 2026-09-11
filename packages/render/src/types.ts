import type { PrintfileSpec } from '@pressline/contract';

/** What an Engine hands the helper: raster bytes (PNG or JPEG) or SVG markup. */
export type RenderInput =
  | { readonly kind: 'raster'; readonly bytes: Uint8Array }
  | { readonly kind: 'svg'; readonly svg: string };

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface RenderOptions {
  /** `contain` letterboxes onto the background; `cover` fills the Spec and crops. Default `contain`. */
  readonly fit?: 'contain' | 'cover';
  /** Behind a contained image, and under any transparent pixels. Default: transparent when the Spec allows alpha, else white. */
  readonly background?: Rgb | 'transparent';
  readonly align?: {
    readonly x?: 'left' | 'center' | 'right';
    readonly y?: 'top' | 'center' | 'bottom';
  };
  /** Upper bound on raw RGBA bytes held at once (input + scaled + canvas); WASM backends refuse above it. */
  readonly maxRawBytes?: number;
}

/** Decoded-and-scaled pixels; always RGBA, 8 bits per channel, row-major. */
export interface Rgba {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/**
 * A backend decodes and scales; the helper does the rest (layout, compositing,
 * PNG encoding with DPI and sRGB) in plain TypeScript so both backends produce
 * byte-identical structure.
 */
export interface Backend {
  readonly name: 'node' | 'wasm';
  /** Intrinsic pixel size (SVG: its declared size or viewBox) without decoding pixels where possible. */
  readonly size: (input: RenderInput) => Promise<{ width: number; height: number }>;
  /** Decode and scale to exactly `width` × `height`. */
  readonly rasterize: (input: RenderInput, width: number, height: number) => Promise<Rgba>;
  /** Only WASM backends have a byte budget; Node lets libvips stream. */
  readonly defaultMaxRawBytes?: number;
}

/** The Spec asks for more than this backend may hold in memory. Ask before rendering with `rawBytesFor`. */
export class RenderRefused extends Error {
  readonly _tag = 'RenderRefused';
  constructor(
    readonly reason: 'budget' | 'format' | 'alpha',
    message: string,
    readonly detail: { readonly required?: number; readonly budget?: number } = {},
  ) {
    super(message);
    this.name = 'RenderRefused';
  }
}

/** The input could not be read or the backend failed. */
export class RenderError extends Error {
  readonly _tag = 'RenderError';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RenderError';
  }
}

export type { PrintfileSpec };
