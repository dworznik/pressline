#!/usr/bin/env node
import { createRequire } from 'node:module'
import { Command } from '@effect/cli'
import { NodeContext, NodeRuntime } from '@effect/platform-node'
import { Cause, Console, Effect } from 'effect'
import { CONFORMANCE_DESCRIPTION, conformanceFlags, conformanceOptions } from './flags.js'
import { formatReport, runConformance } from './suite.js'

const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

class NotConformant {
  readonly _tag = 'NotConformant'
}

/**
 * The same command as `pressline engine conformance` in `@pressline/cli`; this
 * binary stays as an alias for scripts that already call it.
 */
const command = Command.make('pressline-conformance', conformanceFlags, (a) =>
  Effect.gen(function* () {
    const report = yield* runConformance(conformanceOptions(a))
    yield* Console.log(a.json ? JSON.stringify(report, null, 2) : formatReport(report))
    if (!report.ok) return yield* Effect.fail(new NotConformant())
  }).pipe(
    // Anything but a verdict (bad URL, unreachable host, a bug) is printed, then exit 1.
    Effect.tapErrorCause((cause) =>
      Cause.isFailType(cause) && cause.error instanceof NotConformant
        ? Effect.void
        : Console.error(Cause.pretty(cause)),
    ),
  ),
).pipe(Command.withDescription(CONFORMANCE_DESCRIPTION))

Command.run(command, { name: 'pressline-conformance', version })(process.argv).pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
)
