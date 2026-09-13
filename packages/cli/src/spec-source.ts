import { FileSystem } from '@effect/platform'
import type { HttpClient } from '@effect/platform'
import {
  CatalogResponse,
  PrintfileSpec,
  SpecHash,
  specHash,
  type OfferVariant,
} from '@pressline/contract'
import { Effect, Option, Schema } from 'effect'
import { CliError, publicGet, type Instance } from './client.js'

/**
 * Where a Printfile Spec comes from when the caller is not the bridge: the
 * instance's public Offers endpoint, or a file the Engine developer already
 * has. No dimensions are ever typed by hand — a Spec is the provider's, and
 * misremembering one is exactly what Preflight exists to catch.
 */

/** A Printfile Spec and, when it is known, the Spec Hash and the name to print for it. */
export interface NamedSpec {
  readonly spec: PrintfileSpec
  readonly specHash?: SpecHash
  /** `tee-black-front/black-m`. Absent for a Spec read from a file: it is already on the command line. */
  readonly source?: string
}

/** The one line that describes a Spec, wherever a command prints one. */
export const specSummary = (
  spec: {
    readonly width: number
    readonly height: number
    readonly dpi: number
    readonly formats: ReadonlyArray<string>
    readonly alpha: string
  },
  hash?: string,
) =>
  `${spec.width}×${spec.height}px @ ${spec.dpi} dpi, ${spec.formats.join('/')}, alpha ${spec.alpha}${
    hash ? ` (hash ${hash.slice(0, 12)}…)` : ''
  }`

/** The variants of one Offer that share a Printfile Spec: one Placement, one print size, one Spec Hash. */
export interface SpecGroup {
  readonly specHash: SpecHash
  readonly spec: PrintfileSpec
  readonly variants: Array<Omit<OfferVariant, 'spec' | 'specHash'>>
}

export const groupBySpec = (variants: ReadonlyArray<OfferVariant>): SpecGroup[] => {
  const groups: SpecGroup[] = []
  for (const { spec, specHash, ...variant } of variants) {
    const group = groups.find((g) => g.specHash === specHash)
    if (group) group.variants.push(variant)
    else groups.push({ specHash, spec, variants: [variant] })
  }
  return groups
}

/** A Spec group as `pressline offers --json` prints it; the variants are along for the ride. */
const SpecDocument = Schema.Struct({
  spec: PrintfileSpec,
  specHash: Schema.optional(SpecHash),
})

const decodeSpec = <A, I>(schema: Schema.Schema<A, I>, value: unknown, from: string) =>
  Schema.decodeUnknown(schema)(value).pipe(
    Effect.mapError((e) => new CliError({ message: `${from}: ${e.message}` })),
  )

/**
 * `--spec`: a bare Spec, or a group as `pressline offers --json` prints it —
 * anything with a `spec` key. A group's Spec Hash is taken as given; a bare
 * Spec's is recomputed, which is the only way a hand-edited file can be trusted.
 */
const specFromDocument = (text: string, from: string): Effect.Effect<NamedSpec, CliError> =>
  Effect.gen(function* () {
    const value: unknown = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: () => new CliError({ message: `${from}: not JSON` }),
    })
    if (typeof value === 'object' && value !== null && 'spec' in value) {
      const document = yield* decodeSpec(SpecDocument, value, from)
      return {
        spec: document.spec,
        ...(document.specHash === undefined ? {} : { specHash: document.specHash }),
      }
    }
    const spec = yield* decodeSpec(PrintfileSpec, value, from)
    const hash = yield* specHash(spec).pipe(
      Effect.mapError((e) => new CliError({ message: `${from}: ${e.message}` })),
    )
    return { spec, specHash: hash }
  })

/** Everything on stdin, for `--spec -`. */
const stdin = Effect.tryPromise({
  try: async () => {
    const chunks: Uint8Array[] = []
    for await (const chunk of process.stdin) chunks.push(chunk as Uint8Array)
    return Buffer.concat(chunks).toString('utf8')
  },
  catch: (e) => new CliError({ message: `could not read the Spec from stdin: ${String(e)}` }),
})

/**
 * The Specs to check against: one named variant's, every distinct Spec of an
 * Offer, the one in a file, or none at all — which is a legitimate answer, and
 * the report says which rows it costs.
 */
export const resolveSpecs = (options: {
  readonly offer: Option.Option<string>
  readonly variant: Option.Option<string>
  readonly spec: Option.Option<string>
}): Effect.Effect<
  readonly NamedSpec[],
  CliError,
  Instance | HttpClient.HttpClient | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    if (Option.isSome(options.spec) && Option.isSome(options.offer)) {
      return yield* new CliError({
        message: 'pass either --spec or --offer, not both: they are two ways to the same Spec',
      })
    }
    if (Option.isSome(options.variant) && Option.isNone(options.offer)) {
      return yield* new CliError({
        message: '--variant names a variant of --offer; pass --offer too',
      })
    }
    if (Option.isSome(options.spec)) {
      const from = options.spec.value
      const fs = yield* FileSystem.FileSystem
      const text =
        from === '-'
          ? yield* stdin
          : yield* fs
              .readFileString(from)
              .pipe(Effect.mapError((e) => new CliError({ message: `${from}: ${e.message}` })))
      return [yield* specFromDocument(text, from)]
    }
    if (Option.isNone(options.offer)) return []
    const slug = options.offer.value
    const catalog = yield* publicGet('/api/offers', CatalogResponse)
    const offer = catalog.offers.find((o) => o.slug === slug)
    if (!offer) {
      return yield* new CliError({
        message: `this instance sells no Offer "${slug}"; run: pressline offers`,
      })
    }
    if (Option.isSome(options.variant)) {
      const key = options.variant.value
      const variant = offer.variants.find((v) => v.key === key)
      if (!variant) {
        return yield* new CliError({
          message: `Offer "${slug}" has no variant "${key}": ${offer.variants.map((v) => v.key).join(', ')}`,
        })
      }
      return [{ spec: variant.spec, specHash: variant.specHash, source: `${slug}/${key}` }]
    }
    // No variant: every distinct Spec the Offer asks for, named by the variants that share it.
    return groupBySpec(offer.variants).map((g) => ({
      spec: g.spec,
      specHash: g.specHash,
      source: `${slug}/${g.variants.map((v) => v.key).join(',')}`,
    }))
  })
