# @pressline/conformance

Run it against your Engine before wiring it to a Pressline instance:

```sh
npx @pressline/conformance https://engine.example --secret $ENGINE_SECRET --design some-design-id
```

```
✓ health      protocol version 1
✓ design      "Blue heron" sellable, aspect 3:4
✓ preview     https://engine.example/p/heron.png answers 206
✓ render      answered 202 (retry after 500 ms), then 200 ready
✓ idempotent  a repeat request returns the same URL and Spec Hash
✓ printfile   https://engine.example/files/…: 1200×1600 image/png, 812345 bytes
✓ rejects     422 aspect_mismatch: this design is 3:4
Conformant.
```

The file check is Pressline's own validator from `@pressline/contract`, so what passes here passes in production. As a test helper:

```ts
import { conformance } from '@pressline/conformance';
const report = await conformance({ baseUrl, secret, designId, fetch: app.fetch });
expect(report.ok).toBe(true);
```
