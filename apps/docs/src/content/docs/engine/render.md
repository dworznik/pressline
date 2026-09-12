---
title: Rendering with @pressline/render
description: One call from an image and a Spec to a print-ready PNG, on Node or in a Worker.
---

```ts
import { render } from '@pressline/render'
import { nodeBackend } from '@pressline/render/node' // sharp
// or: const backend = await createWasmBackend({ modules, maxRawBytes }) from '@pressline/render/wasm'

const png = await render(nodeBackend, { kind: 'svg', svg }, spec, {
  fit: 'cover', // or 'contain'
  background: 'transparent', // or { r, g, b }; the default follows spec.alpha
  align: { x: 'center', y: 'center' },
})
```

The output always satisfies the Spec: exact dimensions, DPI in `pHYs`, sRGB declared, RGBA when alpha is allowed or required, RGB flattened onto the background when forbidden. Both backends share the same layout, compositing and PNG writer, so they produce the same structure; only decoding and scaling differ.

**Budget.** A Worker holds about 128 MiB. The WASM backend refuses a render whose raw pixels would not fit (`RenderRefused`, `reason: 'budget'`, with the numbers); `fitsBudget(spec, backend)` answers the same question before you promise a Customer anything. See the [Worker-fit table](/print/products/) for typical placements.

Not covered: EXIF orientation (rotate phone photos first), color management beyond declaring sRGB, bleed.
