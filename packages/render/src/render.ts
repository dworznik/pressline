import type { PrintfileSpec } from '@pressline/contract';
import { compose, layout } from './compose.js';
import { rasterSize, svgSize } from './header.js';
import { encodePng } from './png.js';
import {
  RenderError,
  RenderRefused,
  type Backend,
  type RenderInput,
  type RenderOptions,
} from './types.js';

const WHITE = { r: 255, g: 255, b: 255 } as const;

/**
 * Raw RGBA bytes a render holds at its peak: the decoded source, the scaled
 * copy (≈ the canvas) and the canvas with its filtered rows for encoding.
 * Without a source size (an Engine asking up front) the source is assumed
 * no larger than the canvas.
 */
export const rawBytesFor = (
  spec: Pick<PrintfileSpec, 'width' | 'height'>,
  source?: { readonly width: number; readonly height: number },
): number => {
  const canvas = spec.width * spec.height * 4;
  const src = source ? source.width * source.height * 4 : canvas;
  return src + canvas * 3;
};

/**
 * Tell an Engine up front whether a Spec fits a backend's budget, so it can
 * decline an Offer (or route it to Node) before a Customer waits on it.
 */
export const fitsBudget = (
  spec: Pick<PrintfileSpec, 'width' | 'height'>,
  backend: Pick<Backend, 'defaultMaxRawBytes'>,
  options: Pick<RenderOptions, 'maxRawBytes'> = {},
  source?: { readonly width: number; readonly height: number },
): { ok: true } | { ok: false; required: number; budget: number } => {
  const budget = options.maxRawBytes ?? backend.defaultMaxRawBytes;
  if (budget === undefined) return { ok: true };
  const required = rawBytesFor(spec, source);
  return required <= budget ? { ok: true } : { ok: false, required, budget };
};

const overBudget = (
  spec: Pick<PrintfileSpec, 'width' | 'height'>,
  b: { required: number; budget: number },
) =>
  new RenderRefused(
    'budget',
    `rendering ${spec.width}×${spec.height} needs ~${Math.ceil(b.required / 1048576)} MiB of raw pixels, over this backend's ${Math.floor(b.budget / 1048576)} MiB`,
    { required: b.required, budget: b.budget },
  );

const sourceSize = async (backend: Backend, input: RenderInput) => {
  const cheap = input.kind === 'raster' ? rasterSize(input.bytes) : svgSize(input.svg);
  if (cheap) return cheap;
  return backend.size(input);
};

/**
 * Render `input` into a PNG that satisfies `spec` (ADR-0002: the Engine
 * renders, Pressline validates headers): exact dimensions, DPI stamped,
 * sRGB declared, alpha per the Spec's rule. Fit, background and alignment
 * are the Engine's choice; the Spec's dimensions are not.
 */
export const render = async (
  backend: Backend,
  input: RenderInput,
  spec: PrintfileSpec,
  options: RenderOptions = {},
): Promise<Uint8Array> => {
  if (!spec.formats.includes('png')) {
    throw new RenderRefused(
      'format',
      `this Spec accepts ${spec.formats.join(', ')}; the helper produces PNG`,
    );
  }
  const alphaOut = spec.alpha !== 'forbidden';
  const background = options.background ?? (alphaOut ? 'transparent' : WHITE);
  if (spec.alpha === 'required' && background !== 'transparent') {
    throw new RenderRefused(
      'alpha',
      'this Spec requires transparency; a background would make the file opaque',
    );
  }
  if (spec.alpha === 'forbidden' && background === 'transparent') {
    throw new RenderRefused('alpha', 'this Spec forbids transparency; give a background colour');
  }
  // The Spec alone can be over budget; the source's header can push it over too. Both are known before any pixel is decoded.
  const specBudget = fitsBudget(spec, backend, options);
  if (!specBudget.ok) throw overBudget(spec, specBudget);
  const size = await sourceSize(backend, input);
  const budget = fitsBudget(spec, backend, options, size);
  if (!budget.ok) throw overBudget(spec, budget);
  const fit = options.fit ?? 'contain';
  const at = layout(size.width, size.height, spec.width, spec.height, fit, options.align ?? {});
  const scaled = await backend.rasterize(input, at.width, at.height);
  if (scaled.width !== at.width || scaled.height !== at.height) {
    throw new RenderError(
      `backend ${backend.name} returned ${scaled.width}×${scaled.height}, asked for ${at.width}×${at.height}`,
    );
  }
  const canvas = compose(scaled, spec.width, spec.height, at, background);
  return encodePng({ ...canvas, dpi: spec.dpi });
};
