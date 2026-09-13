#!/usr/bin/env node
import { createRequire } from 'node:module'
import { Args, Command, Options } from '@effect/cli'
import { NodeContext, NodeRuntime } from '@effect/platform-node'
import { Cause, Config, Console, Duration, Effect, Redacted } from 'effect'
import { formatReport, runConformance } from './suite.js'

const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

const baseUrl = Args.text({ name: 'baseUrl' }).pipe(Args.withDescription('The Engine base URL'))
const secret = Options.redacted('secret').pipe(
  Options.withDescription('The shared secret Pressline would send'),
  Options.withFallbackConfig(Config.redacted('ENGINE_SECRET')),
)
const design = Options.text('design').pipe(
  Options.withDescription('A Design ID the Engine can render'),
)
const dpi = Options.integer('dpi').pipe(Options.withDefault(150))
const timeout = Options.integer('timeout').pipe(
  Options.withDescription('Seconds to wait for a rendering Engine'),
  Options.withDefault(60),
)
const anyShape = Options.boolean('any-shape').pipe(
  Options.withDescription('Skip the 422 check: this Engine renders any Spec shape'),
)

class NotConformant {
  readonly _tag = 'NotConformant'
}

const command = Command.make(
  'pressline-conformance',
  { baseUrl, secret, design, dpi, timeout, anyShape },
  (a) =>
    Effect.gen(function* () {
      const report = yield* runConformance({
        baseUrl: a.baseUrl,
        secret: Redacted.value(a.secret),
        designId: a.design,
        dpi: a.dpi,
        renderTimeout: Duration.seconds(a.timeout),
        ...(a.anyShape ? { impossibleSpec: false as const } : {}),
      })
      yield* Console.log(formatReport(report))
      if (!report.ok) return yield* Effect.fail(new NotConformant())
    }).pipe(
      // Anything but a verdict (bad URL, unreachable host, a bug) is printed, then exit 1.
      Effect.tapErrorCause((cause) =>
        Cause.isFailType(cause) && cause.error instanceof NotConformant
          ? Effect.void
          : Console.error(Cause.pretty(cause)),
      ),
    ),
).pipe(Command.withDescription('Check an Engine against the Pressline DesignSource protocol'))

// The suite now also lives in the Operator's CLI as `pressline engine conformance`; this
// binary stays as an alias for existing scripts.
Command.run(command, { name: 'pressline-conformance', version })(process.argv).pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
)
