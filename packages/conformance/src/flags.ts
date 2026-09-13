import { Args, Options } from '@effect/cli'
import { Config, Duration, Redacted } from 'effect'
import type { ConformanceOptions } from './suite.js'

/**
 * The command-line surface of the suite, defined once: `pressline engine
 * conformance` and the `pressline-conformance` alias binary both use it, so
 * the two cannot drift.
 */
export const conformanceFlags = {
  baseUrl: Args.text({ name: 'baseUrl' }).pipe(Args.withDescription('The Engine base URL')),
  secret: Options.redacted('secret').pipe(
    Options.withDescription('The shared secret Pressline would send'),
    Options.withFallbackConfig(Config.redacted('ENGINE_SECRET')),
  ),
  design: Options.text('design').pipe(Options.withDescription('A Design ID the Engine can render')),
  dpi: Options.integer('dpi').pipe(
    Options.withDescription('DPI of the Spec the suite asks for'),
    Options.withDefault(150),
  ),
  timeout: Options.integer('timeout').pipe(
    Options.withDescription('Seconds to wait for a rendering Engine'),
    Options.withDefault(60),
  ),
  anyShape: Options.boolean('any-shape').pipe(
    Options.withDescription('Skip the 422 check: this Engine renders any Spec shape'),
  ),
  format: Options.choice('format', ['png', 'jpeg']).pipe(
    Options.withDescription('The one container the Spec asks for; jpeg also forbids transparency'),
    Options.withDefault('png' as const),
  ),
  strict: Options.boolean('strict').pipe(
    Options.withDescription('Fail on Deviations too, not only on what Validation would refuse'),
  ),
  json: Options.boolean('json').pipe(
    Options.withDescription('Print the report as JSON: every check, with the Printfile Inspection'),
  ),
}

export interface ConformanceFlagValues {
  readonly baseUrl: string
  readonly secret: Redacted.Redacted
  readonly design: string
  readonly dpi: number
  readonly timeout: number
  readonly anyShape: boolean
  readonly format: 'png' | 'jpeg'
  readonly strict: boolean
  readonly json: boolean
}

/** The parsed flags as `runConformance` wants them. `--json` is the printer's, not the suite's. */
export const conformanceOptions = (
  a: ConformanceFlagValues,
  fetch?: typeof globalThis.fetch,
): ConformanceOptions => ({
  baseUrl: a.baseUrl,
  secret: Redacted.value(a.secret),
  designId: a.design,
  dpi: a.dpi,
  format: a.format,
  strict: a.strict,
  renderTimeout: Duration.seconds(a.timeout),
  ...(a.anyShape ? { impossibleSpec: false as const } : {}),
  ...(fetch ? { fetch } : {}),
})

export const CONFORMANCE_DESCRIPTION = 'Check an Engine against the Pressline DesignSource protocol'
