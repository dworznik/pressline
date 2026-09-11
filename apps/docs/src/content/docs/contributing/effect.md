---
title: Effect primer
description: Enough Effect to read and change Pressline.
---

Pressline's server is [Effect](https://effect.website) throughout. What you meet in the code:

- **`Effect<A, E, R>`**: a description of a computation producing `A`, failing with typed `E`, needing services `R`. Nothing runs until a runtime runs it. `Effect.gen(function* () { const x = yield* step; … })` sequences steps.
- **Services** are `Context.Tag`s (`Db`, `Psp`, `FulfilmentProvider`, `Mailer`, `DesignSource`, `Config`); **Layers** build them. Tests provide in-memory layers; production provides adapters. The web handler is built once from a `Layer` of services.
- **Errors** are `Schema.TaggedError` classes; the HTTP layer maps each to a status. `Effect.either` when you want to inspect a failure; `Effect.orDie` for infrastructure faults that are bugs, not outcomes.
- **Schema** validates every boundary: config, env, API bodies, database rows, provider wire shapes.
- **HttpApi**: endpoints are declared once (`api.ts`), implemented by groups, served by `HttpApiBuilder.toWebHandler`, and the same declaration produces the OpenAPI document. The Engine-facing contract is its own `HttpApi` in `@pressline/contract`, from which the Engine client is derived.
- **Clock**: time comes from Effect's `Clock`, so tests advance it.

Read `docs/adr/0011-effect-throughout.md` for why.
