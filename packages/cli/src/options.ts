import { Options } from '@effect/cli'

/**
 * Flags shared by more than one command, defined once so they cannot describe
 * themselves differently in two places.
 */

/**
 * The exit rule's second half, on `printfile check` and `engine preflight`
 * alike. `engine conformance` declares its own in `@pressline/conformance`,
 * which ships without this package.
 */
export const strict = Options.boolean('strict').pipe(
  Options.withDescription('Fail on Deviations too, not only on what Validation would refuse'),
)
