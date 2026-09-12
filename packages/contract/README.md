# @pressline/contract

The DesignSource protocol between Pressline and an Engine: the Printfile Spec and its canonical Spec Hash, every request/response schema, the protocol as an Effect `HttpApi`, and a typed client.

```ts
import {
  canonicalize,
  specHash,
  EngineApi,
  makeEngineClient,
  PROTOCOL_VERSION,
} from '@pressline/contract'
```

- `PrintfileSpec`, `canonicalize` (→ `Either<string, InvalidPrintfileSpec>`), `specHash` (→ `Effect<string, InvalidPrintfileSpec>`) — the Spec an Engine renders to and the hash both sides agree on (test vectors in `tests/spec-hash.test.ts`). Non-Effect code: `await Effect.runPromise(specHash(spec))`.
- `DesignResponse`, `PrintfileReady` (200), `PrintfileRendering` (202), `PrintfileRejected` (422), `DesignNotFound` (404), `EngineHealth` — wire schemas.
- `EngineApi` — the protocol as an `HttpApi`; implement it with `HttpApiBuilder` or follow the paths from any stack.
- `makeEngineClient({ baseUrl, secret })` — Pressline's client; needs an `HttpClient` (`FetchHttpClient.layer`).
- `CatalogResponse` — what Pressline's public `GET /api/offers` returns, so Engines can pre-render.

Peer dependencies: `effect`, `@effect/platform`. MIT.
