import { FetchHttpClient } from '@effect/platform'
import { Args, Command, Options } from '@effect/cli'
import { formatReport, runConformance } from '@pressline/conformance'
import { Config, Duration, Effect, Option, Redacted } from 'effect'
import { CliError } from './client.js'
import { print } from './output.js'

/**
 * `pressline engine …` — the Engine developer's commands. They talk to the
 * Engine, never to the operator API, so the root `--token` is not needed.
 */
const baseUrl = Args.text({ name: 'baseUrl' }).pipe(Args.withDescription('The Engine base URL'))
const secret = Options.redacted('secret').pipe(
  Options.withDescription('The shared secret Pressline would send'),
  Options.withFallbackConfig(Config.redacted('ENGINE_SECRET')),
)
const design = Options.text('design').pipe(
  Options.withDescription('A Design ID the Engine can render'),
)
const dpi = Options.integer('dpi').pipe(
  Options.withDescription('DPI of the Spec the suite asks for'),
  Options.withDefault(150),
)
const timeout = Options.integer('timeout').pipe(
  Options.withDescription('Seconds to wait for a rendering Engine'),
  Options.withDefault(60),
)
const anyShape = Options.boolean('any-shape').pipe(
  Options.withDescription('Skip the 422 check: this Engine renders any Spec shape'),
)

const conformance = Command.make(
  'conformance',
  { baseUrl, secret, design, dpi, timeout, anyShape },
  (a) =>
    Effect.gen(function* () {
      // Use the fetch the CLI was given (tests route it in-process); the global one otherwise.
      const fetch = yield* Effect.serviceOption(FetchHttpClient.Fetch)
      const report = yield* runConformance({
        baseUrl: a.baseUrl,
        secret: Redacted.value(a.secret),
        designId: a.design,
        dpi: a.dpi,
        renderTimeout: Duration.seconds(a.timeout),
        ...(a.anyShape ? { impossibleSpec: false as const } : {}),
        ...(Option.isSome(fetch) ? { fetch: fetch.value } : {}),
      })
      yield* print(formatReport(report))
      if (!report.ok) return yield* Effect.fail(new CliError({ message: 'not conformant' }))
    }).pipe(
      // Anything short of a verdict (an http:// URL, a bug) becomes one readable line.
      Effect.mapError((e) =>
        e instanceof CliError ? e : new CliError({ message: `${e._tag}: ${JSON.stringify(e)}` }),
      ),
    ),
).pipe(Command.withDescription('Check an Engine against the Pressline DesignSource protocol'))

export const engine = Command.make('engine').pipe(
  Command.withDescription("The Engine developer's commands"),
  Command.withSubcommands([conformance]),
)
