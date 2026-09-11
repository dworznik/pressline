# @pressline/render

The reference "fit, pad, stamp" for Engines (ADR-0002): give it an image and a Printfile Spec, get a PNG that Pressline's validator accepts — exact dimensions, DPI in `pHYs`, sRGB declared, RGB or RGBA as the Spec's alpha rule demands.

```ts
import { render } from '@pressline/render';
import { nodeBackend } from '@pressline/render/node'; // sharp

const png = await render(nodeBackend, { kind: 'raster', bytes }, spec, {
  fit: 'contain', // or 'cover'
  background: 'transparent', // or { r, g, b }; default follows spec.alpha
  align: { x: 'center', y: 'center' },
});
```

In a Worker or browser, use the WASM backend and hand it the compiled modules:

```ts
import { createWasmBackend } from '@pressline/render/wasm';
import png from '@jsquash/png/codec/pkg/squoosh_png_bg.wasm';
import jpeg from '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm';
import resize from '@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm';
import resvg from '@resvg/resvg-wasm/index_bg.wasm'; // only if you render SVG

const backend = await createWasmBackend({
  modules: { png, jpeg, resize, resvg },
  maxRawBytes: 64 * 1024 * 1024,
});
```

## Byte budget

A Worker holds ~128 MiB. The WASM backend refuses, with `RenderRefused` (`reason: 'budget'`, `detail: { required, budget }`), any Spec whose raw pixels would not fit; `fitsBudget(spec, backend)` and `rawBytesFor(spec)` answer the same question before a Customer waits on it, so an Engine can decline an Offer or route it to Node. The Node backend streams through libvips and has no budget.

## What it does not do

Colour management beyond declaring sRGB, bleed, or any print-shop judgement. Pressline never runs it: the bridge validates headers only (ADR-0002) and the app is lint-banned from importing this package.
