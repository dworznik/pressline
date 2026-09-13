# @pressline/contract

The DesignSource protocol between Pressline and an Engine: the Printfile Spec and its canonical Spec Hash, every request/response schema, the protocol as an Effect `HttpApi`, and a typed client.

```ts
import {
  canonicalize,
  specHash,
  EngineApi,
  makeEngineClient,
  PROTOCOL_VERSION,
  parseImageHeader,
  checkPrintfile,
  deviations,
} from '@pressline/contract'
```

- `PrintfileSpec`, `canonicalize` (→ `Either<string, InvalidPrintfileSpec>`), `specHash` (→ `Effect<string, InvalidPrintfileSpec>`) — the Spec an Engine renders to and the hash both sides agree on (test vectors in `tests/spec-hash.test.ts`). Non-Effect code: `await Effect.runPromise(specHash(spec))`.
- `DesignResponse`, `PrintfileReady` (200), `PrintfileRendering` (202), `PrintfileRejected` (422), `DesignNotFound` (404), `EngineHealth` — wire schemas.
- `EngineApi` — the protocol as an `HttpApi`; implement it with `HttpApiBuilder` or follow the paths from any stack.
- `makeEngineClient({ baseUrl, secret })` — Pressline's client; needs an `HttpClient` (`FetchHttpClient.layer`).
- `CatalogResponse` — what Pressline's public `GET /api/offers` returns, so Engines can pre-render.
- `parseImageHeader` — the header read: format, size, three-valued `alpha`, and what else the first bytes say (PNG bit depth, color type, interlacing, the chunks before `IDAT`, `pHYs` as dpi, the `iCCP` name and size; JPEG precision, channel count, Adobe transform, JFIF density). No pixels are decoded and nothing is inflated (ADR-0002).
- `checkPrintfile(header, spec, facts)` — the verdict: `PrintfileInvalid` or `undefined`. Pure, and the only place a Printfile is refused, so Validation, `printfile check` and an Engine's own check cannot disagree.
- `deviations(header, spec?)` — what the file departs from without being refused: bit depth, interlacing, color space, CMYK, the DPI stamp, and a chunk table that outruns the 64 KiB header window. Each carries a code and a message to act on.

Peer dependencies: `effect`, `@effect/platform`. MIT.
