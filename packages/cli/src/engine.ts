import { FetchHttpClient } from '@effect/platform'
import { Command } from '@effect/cli'
import {
  CONFORMANCE_DESCRIPTION,
  conformanceFlags,
  conformanceOptions,
  formatReport,
  runConformance,
} from '@pressline/conformance'
import { Effect, Option } from 'effect'
import { CliError } from './client.js'
import { print } from './output.js'

/**
 * `pressline engine …` — the Engine developer's commands. They talk to the
 * Engine, never to the operator API, so the root `--token` is not needed.
 */
const conformance = Command.make('conformance', conformanceFlags, (a) =>
  Effect.gen(function* () {
    // Use the fetch the CLI was given (tests route it in-process); the global one otherwise.
    const fetch = yield* Effect.serviceOption(FetchHttpClient.Fetch)
    const report = yield* runConformance(conformanceOptions(a, Option.getOrUndefined(fetch)))
    yield* print(formatReport(report))
    if (!report.ok) return yield* Effect.fail(new CliError({ message: 'not conformant' }))
  }).pipe(
    // Anything short of a verdict (an http:// URL, a bug) becomes one readable line.
    Effect.mapError((e) =>
      e instanceof CliError ? e : new CliError({ message: `${e._tag}: ${JSON.stringify(e)}` }),
    ),
  ),
).pipe(Command.withDescription(CONFORMANCE_DESCRIPTION))

export const engine = Command.make('engine').pipe(
  Command.withDescription("The Engine developer's commands"),
  Command.withSubcommands([conformance]),
)
