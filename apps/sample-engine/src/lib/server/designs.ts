import {
  specHash,
  type CatalogueResponse,
  type PrintfileReady,
  type PrintfileSpec,
} from '@pressline/contract';
import {
  fitsBudget,
  render,
  RenderRefused,
  type Backend,
  type RenderInput,
} from '@pressline/render';
import { Effect } from 'effect';
import { ASPECT, toSvg, type Template } from '../template.js';
import type { FileStore } from './store/file-store.js';

/**
 * Designs (CONTEXT.md → Design): what the designer finalised, where its
 * Preview lives, and the Printfiles rendered so far keyed by Spec Hash
 * (ADR-0005: the idempotency key). Metadata is a JSON file in the FileStore
 * so the sample needs no database.
 */
export interface StoredPrintfile {
  readonly url: string;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly contentType: 'image/png' | 'image/jpeg';
}

export interface Design {
  readonly id: string;
  readonly title: string;
  readonly aspect: { readonly w: number; readonly h: number };
  readonly source:
    | { readonly kind: 'svg'; readonly svg: string }
    | { readonly kind: 'raster'; readonly key: string };
  readonly previewUrl: string;
  readonly createdAt: number;
  readonly printfiles: Readonly<Record<string, StoredPrintfile>>;
  /** Offer slugs this Design can be printed on, once the catalogue was seen; absent = all (CONTEXT.md → Eligibility). */
  readonly offers?: ReadonlyArray<string>;
}

export interface Engine {
  readonly store: FileStore;
  readonly backend: Backend;
  /** Pressline's public catalogue; undefined when the Engine runs on its own. */
  readonly catalogue: () => Promise<CatalogueResponse | undefined>;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** 96 bits of randomness in the DesignId alphabet: unguessable, and a valid Design ID. */
export const newDesignId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => B64[b & 63]).join('');

const sha256Hex = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

const metaKey = (id: string) => `designs/${id}.json`;

export const loadDesign = async (store: FileStore, id: string): Promise<Design | undefined> => {
  const bytes = await store.get(metaKey(id));
  return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as Design) : undefined;
};

/** Metadata is the one mutable record: Printfiles accumulate under their Spec Hash. */
const saveDesign = (store: FileStore, design: Design) =>
  store.overwrite(
    metaKey(design.id),
    new TextEncoder().encode(JSON.stringify(design)),
    'application/json',
  );
const updateDesign = saveDesign;

const inputFor = async (engine: Engine, design: Design): Promise<RenderInput> => {
  if (design.source.kind === 'svg') return { kind: 'svg', svg: design.source.svg };
  const bytes = await engine.store.get(design.source.key);
  if (!bytes) throw new Error(`source ${design.source.key} is gone`);
  return { kind: 'raster', bytes };
};

/** Aspect within 5 % of the Design's: anything else is a different product shape. */
export const aspectFits = (design: Design, spec: PrintfileSpec) => {
  const want = design.aspect.w / design.aspect.h;
  const got = spec.width / spec.height;
  return Math.abs(got - want) / want <= 0.05;
};

/** Render (or reuse) the Printfile for a Spec; the Spec Hash is the key. */
export const ensurePrintfile = async (
  engine: Engine,
  design: Design,
  spec: PrintfileSpec,
): Promise<
  | { ready: PrintfileReady; design: Design }
  | { rejected: 'aspect_mismatch' | 'other'; message: string }
> => {
  const hash = await Effect.runPromise(specHash(spec));
  const stored = design.printfiles[hash];
  if (stored) return { ready: { status: 'ready', specHash: hash, ...stored }, design };
  if (!aspectFits(design, spec)) {
    return {
      rejected: 'aspect_mismatch',
      message: `this design is ${design.aspect.w}:${design.aspect.h}`,
    };
  }
  const budget = fitsBudget(spec, engine.backend);
  if (!budget.ok) {
    return {
      rejected: 'other',
      message: `${spec.width}×${spec.height} is over this Engine's render budget`,
    };
  }
  let png: Uint8Array;
  try {
    png = await render(engine.backend, await inputFor(engine, design), spec, {
      fit: 'cover',
      background: spec.alpha === 'forbidden' ? { r: 255, g: 255, b: 255 } : 'transparent',
    });
  } catch (e) {
    if (e instanceof RenderRefused) return { rejected: 'other', message: e.message };
    throw e;
  }
  const url = await engine.store.put(`printfiles/${design.id}/${hash}.png`, png, 'image/png');
  const file: StoredPrintfile = {
    url,
    sha256: await sha256Hex(png),
    width: spec.width,
    height: spec.height,
    bytes: png.length,
    contentType: 'image/png',
  };
  // Re-read before writing: another request may have added a Printfile meanwhile.
  const latest = (await loadDesign(engine.store, design.id)) ?? design;
  const next: Design = { ...latest, printfiles: { ...latest.printfiles, [hash]: file } };
  await updateDesign(engine.store, next);
  return { ready: { status: 'ready', specHash: hash, ...file }, design: next };
};

/** The Spec Pressline would derive: width/height already there per variant. */
export const finalise = async (
  engine: Engine,
  input: { template: Partial<Template> } | { raster: Uint8Array; title: string },
): Promise<Design> => {
  const id = newDesignId();
  const source: Design['source'] =
    'template' in input
      ? { kind: 'svg', svg: toSvg(input.template) }
      : { kind: 'raster', key: `sources/${id}.png` };
  if (source.kind === 'raster' && 'raster' in input) {
    await engine.store.put(source.key, input.raster, 'image/png');
  }
  const renderInput: RenderInput =
    source.kind === 'svg'
      ? { kind: 'svg', svg: source.svg }
      : { kind: 'raster', bytes: (input as { raster: Uint8Array }).raster };
  // Preview: a modest PNG for the Storefront and emails (hot-linked, ADR-0003).
  const preview = await render(
    engine.backend,
    renderInput,
    {
      width: 600,
      height: 800,
      dpi: 72,
      formats: ['png'],
      colorSpace: 'srgb',
      alpha: 'allowed',
      placement: 'preview',
      technique: 'preview',
    },
    { fit: 'cover', background: 'transparent' },
  );
  const previewUrl = await engine.store.put(`previews/${id}.png`, preview, 'image/png');
  let design: Design = {
    id,
    title: 'template' in input ? (input.template.text ?? 'Untitled').slice(0, 40) : input.title,
    aspect: ASPECT,
    source,
    previewUrl,
    createdAt: Date.now(),
    printfiles: {},
  };
  await saveDesign(engine.store, design);

  // Pre-render for every Offer and variant Pressline sells, so checkout never waits (SPEC story 2).
  const catalogue = await engine.catalogue().catch(() => undefined);
  if (catalogue) {
    // Eligibility is written after every Offer, so a failure half-way leaves a
    // truthful list rather than "eligible for everything".
    const eligible: string[] = [];
    design = { ...design, offers: [] };
    await updateDesign(engine.store, design);
    for (const offer of catalogue.offers) {
      let ok = true;
      for (const variant of offer.variants) {
        const result = await ensurePrintfile(engine, design, variant.spec).catch((e: unknown) => ({
          rejected: 'other' as const,
          message: e instanceof Error ? e.message : String(e),
        }));
        if ('ready' in result) design = result.design;
        else ok = false;
      }
      if (ok) eligible.push(offer.slug);
      design = {
        ...((await loadDesign(engine.store, design.id)) ?? design),
        offers: [...eligible],
      };
      await updateDesign(engine.store, design);
    }
  }
  return design;
};
