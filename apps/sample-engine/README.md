# Sample Engine

A small template designer that speaks the Pressline DesignSource protocol. Copy it to start your own Engine.

```sh
ENGINE_SECRET=dev-secret PRESSLINE_URL=http://localhost:5173 pnpm dev   # http://localhost:5174
```

- `/` — pick text, colors and a shape; **Finalize** stores the Design (unguessable ID), renders a Preview, fetches Pressline's catalog (`GET /api/offers`) and pre-renders a Printfile per Offer and variant with `@pressline/render`. Offers whose Spec does not fit (aspect, render budget) are left out of the Design's `offers`.
- `/d/<id>` — the finished design with **Order a print**, which lands on `PRESSLINE_URL/order/<ENGINE_SLUG>/<id>`.
- `GET /designs/<id>`, `POST /designs/<id>/printfile`, `GET /health` — the protocol, bearer-protected by `ENGINE_SECRET`.
- `FileStore`: filesystem (`./data`, served at `/files/*`), R2 (`FILES=r2`) or Vercel Blob (`FILES=blob`). URLs are public and immutable.
- AI: set `OPENAI_API_KEY` and a prompt box appears; the image goes through the same render path.
- Text is emitted as outlines from a bundled open-licensed font (`src/lib/fonts/`, SIL OFL 1.1), so the render needs no font on the host; Vercel functions and Workers ship none.

The sample renders synchronously and always answers 200; an Engine whose renders take longer than a request may answer `202 { retryAfterMs }` and finish in the background (ADR-0005) — Pressline polls.

Its tests are the conformance suite run in-process: `pnpm test`. Deploy: `vercel.json` here (root directory `apps/sample-engine`, Vercel Blob) and `deploy/wrangler.toml` (Workers + R2 + WASM rendering, `PRESSLINE_ADAPTER=cloudflare pnpm build` first).
