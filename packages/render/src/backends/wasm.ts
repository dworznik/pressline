import decodeJpeg, { init as initJpeg } from '@jsquash/jpeg/decode.js';
import decodePng, { init as initPng } from '@jsquash/png/decode.js';
import resize, { initResize } from '@jsquash/resize';
import type * as ResvgModule from '@resvg/resvg-wasm';
import { RenderError, type Backend, type Rgba } from '../types.js';

type WasmSource = WebAssembly.Module | BufferSource;

export interface WasmModules {
  /** `@jsquash/png/codec/pkg/squoosh_png_bg.wasm` */
  readonly png: WasmSource;
  /** `@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm` */
  readonly jpeg: WasmSource;
  /** `@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm` */
  readonly resize: WasmSource;
  /** `@resvg/resvg-wasm/index_bg.wasm`; leave out if the Engine never renders SVG. */
  readonly resvg?: WasmSource;
}

export interface WasmBackendOptions {
  readonly modules: WasmModules;
  /** Raw RGBA bytes the backend may hold at once. Default 64 MiB: half a Worker's 128 MiB. */
  readonly maxRawBytes?: number;
}

export const DEFAULT_WASM_BUDGET = 64 * 1024 * 1024;

let resvgReady: Promise<void> | undefined;

const toModule = async (m: WasmSource) =>
  m instanceof WebAssembly.Module ? m : WebAssembly.compile(m);

/**
 * Pure-WASM backend for Workers and browsers: mozjpeg/png decoders and the
 * squoosh resizer, resvg for SVG. The caller hands in the compiled modules
 * (Workers import `.wasm` files; Node reads them from `node_modules`).
 */
export const createWasmBackend = async (options: WasmBackendOptions): Promise<Backend> => {
  const [png, jpeg, rs] = await Promise.all([
    toModule(options.modules.png),
    toModule(options.modules.jpeg),
    toModule(options.modules.resize),
  ]);
  await Promise.all([initPng(png), initJpeg(jpeg), initResize(rs)]);
  let resvg: typeof ResvgModule | undefined;
  if (options.modules.resvg) {
    resvg = await import('@resvg/resvg-wasm');
    // resvg's initWasm may run once per isolate: the first module wins and later backends share it.
    resvgReady ??= resvg.initWasm(await toModule(options.modules.resvg));
    await resvgReady;
  }
  const decode = async (bytes: Uint8Array): Promise<Rgba> => {
    const buf = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!isPng && !isJpeg) throw new RenderError('input is neither PNG nor JPEG');
    try {
      const img = isPng ? await decodePng(buf) : await decodeJpeg(buf);
      return { width: img.width, height: img.height, data: img.data };
    } catch (e) {
      throw new RenderError('could not decode the input', { cause: e });
    }
  };
  const svgToRgba = (svg: string, width: number, height: number): Rgba => {
    if (!resvg) throw new RenderError('SVG input needs the resvg module');
    try {
      // Constrain the axis the layout constrained, so rounding cannot leave a one-pixel mismatch to resample.
      const r = new resvg.Resvg(svg, {
        fitTo:
          width >= height ? { mode: 'width', value: width } : { mode: 'height', value: height },
      });
      const out = r.render();
      const data = new Uint8ClampedArray(
        out.pixels.buffer,
        out.pixels.byteOffset,
        out.pixels.byteLength,
      );
      r.free();
      return { width: out.width, height: out.height, data };
    } catch (e) {
      throw new RenderError('could not rasterise the SVG', { cause: e });
    }
  };
  return {
    name: 'wasm',
    defaultMaxRawBytes: options.maxRawBytes ?? DEFAULT_WASM_BUDGET,
    size: async (input) => {
      if (input.kind === 'raster') {
        // Only reached for a header the cheap probe could not read: decode to find out.
        const img = await decode(input.bytes);
        return { width: img.width, height: img.height };
      }
      if (!resvg) throw new RenderError('SVG input needs the resvg module');
      try {
        const r = new resvg.Resvg(input.svg);
        const size = { width: r.width, height: r.height };
        r.free();
        return size;
      } catch (e) {
        throw new RenderError('could not read the SVG', { cause: e });
      }
    },
    rasterize: async (input, width, height) => {
      const src =
        input.kind === 'svg' ? svgToRgba(input.svg, width, height) : await decode(input.bytes);
      if (src.width === width && src.height === height) return src;
      const out = await resize(
        { width: src.width, height: src.height, data: src.data } as ImageData,
        { width, height, method: 'lanczos3', premultiply: true, linearRGB: false },
      );
      return { width: out.width, height: out.height, data: out.data };
    },
  };
};
