import { Console, Context, Effect, Layer } from 'effect';

/** Where lines go; stdout in the binary, a buffer in tests. */
export class Output extends Context.Tag('@pressline/cli/Output')<
  Output,
  { readonly line: (text: string) => Effect.Effect<void> }
>() {}

export const OutputStdout = Layer.succeed(Output, { line: (text) => Console.log(text) });

export const print = (...lines: ReadonlyArray<string>) =>
  Effect.flatMap(Output, (out) => Effect.forEach(lines, out.line, { discard: true }));
