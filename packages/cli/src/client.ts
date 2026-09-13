import { HttpClient, HttpClientRequest, HttpClientResponse } from '@effect/platform'
import { Context, Effect, Option, Redacted, Schema } from 'effect'

/**
 * Where the CLI talks to: one Pressline instance and, for the Operator's
 * commands, its operator token (ADR-0014: only the operator API, never the
 * database). The Engine developer's commands read public endpoints and need
 * no token, so it is optional here and demanded per call.
 */
export interface InstanceValue {
  readonly url: Option.Option<string>
  readonly token: Option.Option<Redacted.Redacted>
}
export class Instance extends Context.Tag('@pressline/cli/Instance')<Instance, InstanceValue>() {}

export class CliError extends Schema.TaggedError<CliError>()('CliError', {
  message: Schema.String,
}) {}

const ApiError = Schema.Struct({ message: Schema.optional(Schema.String) })

/** Call the operator API and decode the answer; every failure becomes one readable `CliError`. */
export const api = <A, I>(
  method: 'GET' | 'POST',
  path: string,
  schema: Schema.Schema<A, I>,
  body?: unknown,
): Effect.Effect<A, CliError, Instance | HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const { token } = yield* Instance
    if (Option.isNone(token)) {
      return yield* new CliError({
        message: 'this command needs the operator token: pass --token or set PRESSLINE_TOKEN',
      })
    }
    return yield* call(method, path, schema, body, Redacted.value(token.value))
  })

/** Read an endpoint anyone may read (`/api/offers`); no token is sent or needed. */
export const publicGet = <A, I>(
  path: string,
  schema: Schema.Schema<A, I>,
): Effect.Effect<A, CliError, Instance | HttpClient.HttpClient> => call('GET', path, schema)

const call = <A, I>(
  method: 'GET' | 'POST',
  path: string,
  schema: Schema.Schema<A, I>,
  body?: unknown,
  bearer?: string,
): Effect.Effect<A, CliError, Instance | HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const { url } = yield* Instance
    if (Option.isNone(url)) {
      return yield* new CliError({
        message: 'this command needs the instance URL: pass --url or set PRESSLINE_URL',
      })
    }
    const client = yield* HttpClient.HttpClient
    const request = HttpClientRequest.make(method)(`${url.value.replace(/\/$/, '')}${path}`).pipe(
      bearer === undefined ? (r) => r : HttpClientRequest.bearerToken(bearer),
      body === undefined ? (r) => r : HttpClientRequest.bodyUnsafeJson(body),
    )
    const response = yield* client
      .execute(request)
      .pipe(Effect.mapError((e) => new CliError({ message: `${path}: ${e.message}` })))
    if (response.status === 401) {
      return yield* new CliError({ message: 'unauthorized: check --token / PRESSLINE_TOKEN' })
    }
    if (response.status >= 400) {
      const detail = yield* HttpClientResponse.schemaBodyJson(ApiError)(response).pipe(
        Effect.map((e) => e.message ?? ''),
        Effect.orElseSucceed(() => ''),
      )
      return yield* new CliError({
        message: `${path}: ${response.status}${detail ? ` ${detail}` : ''}`,
      })
    }
    return yield* HttpClientResponse.schemaBodyJson(schema)(response).pipe(
      Effect.mapError((e) => new CliError({ message: `${path}: unexpected answer: ${e.message}` })),
    )
  }).pipe(Effect.scoped)
