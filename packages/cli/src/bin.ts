#!/usr/bin/env node
import { FetchHttpClient } from '@effect/platform';
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import { Effect, Layer } from 'effect';
import { cli } from './cli.js';
import { OutputStdout } from './output.js';

cli(process.argv).pipe(
  Effect.provide(Layer.mergeAll(NodeContext.layer, FetchHttpClient.layer, OutputStdout)),
  NodeRuntime.runMain({ disableErrorReporting: false }),
);
