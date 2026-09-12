import { HttpClient, HttpClientRequest, HttpClientResponse } from '@effect/platform'
import { Context, Effect, Redacted, Schema } from 'effect'

/** Where the CLI talks to: one Pressline instance, one operator token (ADR-0014: only the operator API, never the database). */
export interface InstanceValue {
  readonly url: string
  readonly token: Redacted.Redacted
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
    const { url, token } = yield* Instance
    const client = yield* HttpClient.HttpClient
    const request = HttpClientRequest.make(method)(`${url.replace(/\/$/, '')}${path}`).pipe(
      HttpClientRequest.bearerToken(Redacted.value(token)),
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
