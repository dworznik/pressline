import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { OpenApi } from '@effect/platform';
import { PresslineApi } from '../src/lib/server/http/api';

/** Writes the OpenAPI document for the JSON API (ticket #26); the docs site publishes it. */
const out = resolve(process.argv[2] ?? '../docs/public/openapi.json');
const spec = OpenApi.fromApi(PresslineApi, { additionalPropertiesStrategy: 'strict' });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(spec, null, 2));
console.log(`openapi: ${Object.keys(spec.paths ?? {}).length} paths → ${out}`);
