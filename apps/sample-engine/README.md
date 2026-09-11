# Sample Engine

A small template designer that speaks the Pressline DesignSource protocol. Copy it to start your own Engine.

```sh
ENGINE_SECRET=dev-secret PRESSLINE_URL=http://localhost:5173 pnpm dev   # http://localhost:5174
```

- `/` — pick text, colours and a shape; **Finalise** stores the Design (unguessable ID), renders a Preview, fetches Pressline's catalogue (`GET /api/offers`) and pre-renders a Printfile per Offer and variant with `@pressline/render`. Offers whose Spec does not fit (aspect, render budget) are left out of the Design's `offers`.
- `/d/<id>` — the finished design with **Order a print**, which lands on `PRESSLINE_URL/order/<ENGINE_SLUG>/<id>`.
- `GET /designs/<id>`, `POST /designs/<id>/printfile`, `GET /health` — the protocol, bearer-protected by `ENGINE_SECRET`.
- `FileStore`: filesystem (`./data`, served at `/files/*`), R2 (`FILES=r2`) or Vercel Blob (`FILES=blob`). URLs are public and immutable.
- AI: set `OPENAI_API_KEY` and a prompt box appears; the image goes through the same render path.

Its tests are the conformance suite run in-process: `pnpm test`. Deploy manifests for both platforms are in `deploy/`.
