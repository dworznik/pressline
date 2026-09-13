import { FetchHttpClient, FileSystem, Path } from '@effect/platform'
import { Args, Command, Options } from '@effect/cli'
import {
  CONFORMANCE_DESCRIPTION,
  conformanceFlags,
  conformanceOptions,
  formatReport,
  runConformance,
} from '@pressline/conformance'
import { Effect, Option } from 'effect'
import { CliError, failWith } from './client.js'
import { print } from './output.js'
import { formatPreflight, runPreflight, tally, type PreflightEntry } from './preflight.js'
import { resolveSpecs } from './spec-source.js'

/**
 * `pressline engine …` — the Engine developer's commands. They talk to the
 * Engine, to the instance's public endpoints or to files on disk, never to the
 * operator API, so the root `--token` is not needed.
 */
const conformance = Command.make('conformance', conformanceFlags, (a) =>
  Effect.gen(function* () {
    // Use the fetch the CLI was given (tests route it in-process); the global one otherwise.
    const fetch = yield* Effect.serviceOption(FetchHttpClient.Fetch)
    const report = yield* runConformance(conformanceOptions(a, Option.getOrUndefined(fetch)))
    yield* a.json ? print(JSON.stringify(report, null, 2)) : print(formatReport(report))
    if (!report.ok) return yield* Effect.fail(new CliError({ message: 'not conformant' }))
  }).pipe(
    // Anything short of a verdict (an http:// URL, a bug) becomes one readable line.
    Effect.mapError((e) =>
      e instanceof CliError ? e : new CliError({ message: `${e._tag}: ${JSON.stringify(e)}` }),
    ),
  ),
).pipe(Command.withDescription(CONFORMANCE_DESCRIPTION))

// ---- preflight --------------------------------------------------------------

/** What a directory contributes. A path named on the command line is Preflighted whatever it is called. */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg']

/**
 * The files to Preflight: every path as given, and for a directory the image
 * files directly inside it. Not recursed, and hidden files are skipped, so
 * pointing the command at a build output checks what was built, not a cache.
 */
const collect = (paths: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const files: string[] = []
    for (const given of paths) {
      const info = yield* fs.stat(given)
      if (info.type !== 'Directory') {
        files.push(given)
        continue
      }
      const entries = yield* fs.readDirectory(given)
      for (const name of [...entries].sort()) {
        if (name.startsWith('.')) continue
        if (!IMAGE_EXTENSIONS.includes(path.extname(name).toLowerCase())) continue
        const full = path.join(given, name)
        if ((yield* fs.stat(full)).type === 'File') files.push(full)
      }
    }
    return files
  }).pipe(Effect.mapError((e) => new CliError({ message: e.message })))

const preflightPaths = Args.path({ name: 'path', exists: 'yes' }).pipe(
  Args.withDescription('A Printfile, or a directory of them (not recursed)'),
  Args.atLeast(1),
)

const offer = Options.text('offer').pipe(
  Options.withDescription(
    "Take the Spec from this Offer at --url; without --variant, every one of the Offer's distinct Specs",
  ),
  Options.optional,
)
const variant = Options.text('variant').pipe(
  Options.withDescription('The one variant of --offer whose Spec to check against'),
  Options.optional,
)
const specSource = Options.text('spec').pipe(
  Options.withDescription(
    'A Printfile Spec, or a group as `pressline offers --json` prints it, from a file or `-` for stdin',
  ),
  Options.optional,
)
const strict = Options.boolean('strict').pipe(
  Options.withDescription('Fail on Deviations too, not only on what Validation would refuse'),
)
const asJson = Options.boolean('json').pipe(
  Options.withDescription('Print the report as JSON: the header and the two tiers, per file'),
)

const preflightCommand = Command.make(
  'preflight',
  { paths: preflightPaths, offer, variant, spec: specSource, strict, json: asJson },
  (a) =>
    Effect.gen(function* () {
      const specs = yield* resolveSpecs(a)
      const files = yield* collect(a.paths)
      if (files.length === 0) {
        return yield* failWith('nothing to check: no .png, .jpg or .jpeg file in the given paths')
      }
      const fs = yield* FileSystem.FileSystem
      const entries: PreflightEntry[] = []
      for (const path of files) {
        const bytes = yield* fs
          .readFile(path)
          .pipe(Effect.mapError((e) => new CliError({ message: e.message })))
        // No Spec is a legitimate answer: the file still answers for itself.
        if (specs.length === 0) entries.push({ result: yield* runPreflight({ path, bytes }) })
        for (const spec of specs) {
          entries.push({ result: yield* runPreflight({ path, bytes }, spec), spec })
        }
      }
      yield* a.json
        ? print(JSON.stringify({ results: entries.map((e) => e.result) }, null, 2))
        : print(...formatPreflight(entries))
      const { total, refused, deviating } = tally(entries)
      if (refused > 0) {
        return yield* failWith(`${refused} of ${total} would be refused before payment`)
      }
      if (a.strict && deviating > 0) {
        return yield* failWith(`--strict: ${deviating} of ${total} have Deviations`)
      }
    }),
).pipe(
  Command.withDescription(
    "Preflight local Printfiles against a Spec and the protocol's file requirements, before they are hosted",
  ),
)

export const engine = Command.make('engine').pipe(
  Command.withDescription("The Engine developer's commands"),
  Command.withSubcommands([conformance, preflightCommand]),
)
