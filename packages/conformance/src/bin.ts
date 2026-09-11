#!/usr/bin/env node
import { Args, Command, Options } from '@effect/cli';
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import { Config, Console, Effect, Redacted } from 'effect';
import { formatReport, runConformance } from './suite.js';

const baseUrl = Args.text({ name: 'baseUrl' }).pipe(Args.withDescription('The Engine base URL'));
const secret = Options.redacted('secret').pipe(
  Options.withDescription('The shared secret Pressline would send'),
  Options.withFallbackConfig(Config.redacted('ENGINE_SECRET')),
);
const design = Options.text('design').pipe(
  Options.withDescription('A Design ID the Engine can render'),
);
const dpi = Options.integer('dpi').pipe(Options.withDefault(150));

const command = Command.make('pressline-conformance', { baseUrl, secret, design, dpi }, (a) =>
  Effect.gen(function* () {
    const report = yield* runConformance({
      baseUrl: a.baseUrl,
      secret: Redacted.value(a.secret),
      designId: a.design,
      dpi: a.dpi,
    });
    yield* Console.log(formatReport(report));
    if (!report.ok) return yield* Effect.fail(new Error('not conformant'));
  }),
).pipe(Command.withDescription('Check an Engine against the Pressline DesignSource protocol'));

Command.run(command, { name: 'pressline-conformance', version: '0.1.0' })(process.argv).pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);
