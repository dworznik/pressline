import type { CatalogResponse } from '@pressline/contract';
import { nodeBackend } from '@pressline/render/node';
import type { Backend } from '@pressline/render';
import { makeEngineHandler } from './api.js';
import type { Engine } from './designs.js';
import { blobStore } from './store/blob.js';
import { fsStore } from './store/fs.js';
import { r2Store } from './store/r2.js';

/**
 * Wiring from the environment (mirrors Pressline's ADR-0014 habit: settings
 * in env, nothing secret in code):
 *
 * - `ENGINE_SECRET`   the shared secret Pressline sends (required to serve the protocol)
 * - `PRESSLINE_URL`   the Pressline instance whose catalog we pre-render for (optional)
 * - `ENGINE_SLUG`     how Pressline names this Engine (default `sample`)
 * - `PUBLIC_URL`      this app's public origin (for the fs store's file URLs)
 * - `FILES`           `fs` (default), `r2` (Cloudflare, with the FILES_BUCKET binding and FILES_PUBLIC_URL) or `blob` (Vercel, BLOB_READ_WRITE_TOKEN)
 * - `RENDER_BACKEND`  `node` (default; sharp) or `wasm` (Workers)
 * - `OPENAI_API_KEY`  enables the AI adapter
 */
export interface Settings {
  readonly secret: string;
  readonly presslineUrl?: string;
  readonly engineSlug: string;
  readonly publicUrl: string;
  readonly openAiKey?: string;
}

const str = (env: Record<string, unknown>, k: string) => {
  const v = env[k];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
};

export const settingsFrom = (env: Record<string, unknown>): Settings => {
  const presslineUrl = str(env, 'PRESSLINE_URL');
  const openAiKey = str(env, 'OPENAI_API_KEY');
  return {
    secret: str(env, 'ENGINE_SECRET') ?? '',
    ...(presslineUrl ? { presslineUrl: presslineUrl.replace(/\/$/, '') } : {}),
    engineSlug: str(env, 'ENGINE_SLUG') ?? 'sample',
    publicUrl: str(env, 'PUBLIC_URL') ?? 'http://localhost:5174',
    ...(openAiKey ? { openAiKey } : {}),
  };
};

const storeFrom = (
  env: Record<string, unknown>,
  platform: App.Platform | undefined,
  publicUrl: string,
) => {
  const kind = str(env, 'FILES') ?? 'fs';
  if (kind === 'r2') {
    const bucket = platform?.env?.FILES_BUCKET;
    const origin = str(env, 'FILES_PUBLIC_URL');
    if (!bucket || !origin)
      throw new Error('FILES=r2 needs the FILES_BUCKET binding and FILES_PUBLIC_URL');
    return r2Store(bucket, origin);
  }
  if (kind === 'blob') {
    const token = str(env, 'BLOB_READ_WRITE_TOKEN');
    if (!token) throw new Error('FILES=blob needs BLOB_READ_WRITE_TOKEN');
    return blobStore(token);
  }
  return fsStore(str(env, 'FILES_DIR') ?? './data', publicUrl);
};

const backendFrom = async (
  env: Record<string, unknown>,
  platform: App.Platform | undefined,
  publicUrl: string,
): Promise<Backend> => {
  if (str(env, 'RENDER_BACKEND') === 'wasm') {
    const { createWasmBackend } = await import('@pressline/render/wasm');
    // `?url` gives a root-relative asset path. On Workers static assets are behind the
    // ASSETS binding, not global fetch; elsewhere the app's own origin serves them.
    const assets = platform?.env?.ASSETS as
      { fetch: (r: Request) => Promise<Response> } | undefined;
    const load = async (url: string) => {
      const req = new Request(new URL(url, assets ? 'https://assets.internal' : publicUrl));
      const res = await (assets ? assets.fetch(req) : fetch(req));
      if (!res.ok) throw new Error(`could not load ${url}: ${res.status}`);
      return WebAssembly.compile(await res.arrayBuffer());
    };
    const [png, jpeg, resize, resvg] = await Promise.all([
      import('@jsquash/png/codec/pkg/squoosh_png_bg.wasm?url'),
      import('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm?url'),
      import('@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm?url'),
      import('@resvg/resvg-wasm/index_bg.wasm?url'),
    ]);
    return createWasmBackend({
      modules: {
        png: await load(png.default),
        jpeg: await load(jpeg.default),
        resize: await load(resize.default),
        resvg: await load(resvg.default),
      },
    });
  }
  return nodeBackend;
};

/** Pressline's public catalog, when an instance is configured. */
const catalogFrom = (settings: Settings) => async (): Promise<CatalogResponse | undefined> => {
  if (!settings.presslineUrl) return undefined;
  const res = await fetch(`${settings.presslineUrl}/api/offers`);
  if (!res.ok) throw new Error(`Pressline answered ${res.status}`);
  return (await res.json()) as CatalogResponse;
};

export interface Runtime {
  readonly settings: Settings;
  readonly engine: Engine;
  readonly handler: (request: Request) => Promise<Response>;
}

let cached: Promise<Runtime> | undefined;

export const getRuntime = (platform: App.Platform | undefined): Promise<Runtime> => {
  cached ??= (async () => {
    const env = (platform?.env ?? process.env) as Record<string, unknown>;
    const settings = settingsFrom(env);
    if (!settings.secret)
      throw new Error('ENGINE_SECRET is not set: the protocol cannot be served');
    const engine: Engine = {
      store: storeFrom(env, platform, settings.publicUrl),
      backend: await backendFrom(env, platform, settings.publicUrl),
      catalog: catalogFrom(settings),
    };
    return { settings, engine, handler: makeEngineHandler(engine, settings.secret) };
  })();
  return cached;
};

/** For tests: build a runtime around explicit parts instead of the environment. */
export const makeRuntime = (settings: Settings, engine: Engine): Runtime => ({
  settings,
  engine,
  handler: makeEngineHandler(engine, settings.secret),
});
