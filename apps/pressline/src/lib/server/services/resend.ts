import { HttpClient, HttpClientRequest, HttpClientResponse } from '@effect/platform'
import { Effect, Layer, Schema } from 'effect'
import { Mailer, MailerError, type MailerService } from './mailer'

/**
 * Resend adapter: the shipped Mailer (ticket #12). One HTTP call per email,
 * with the Order/kind as idempotency key so a retried send never doubles.
 */
export interface ResendOptions {
  readonly apiKey: string
  /** `Shop Name <orders@shop.example>`; the domain must be verified in Resend. */
  readonly from: string
  readonly replyTo?: string
  readonly baseUrl?: string
}

const SentWire = Schema.Struct({ id: Schema.String })
const ErrorWire = Schema.Struct({
  message: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
})

export const makeResend = (options: ResendOptions) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(HttpClientRequest.bearerToken(options.apiKey)),
    )
    const base = (options.baseUrl ?? 'https://api.resend.com').replace(/\/$/, '')

    const service: MailerService = {
      send: (email) =>
        HttpClientRequest.post(`${base}/emails`).pipe(
          email.idempotencyKey
            ? HttpClientRequest.setHeader('Idempotency-Key', email.idempotencyKey)
            : (r) => r,
          HttpClientRequest.bodyJson({
            from: options.from,
            to: [email.to],
            subject: email.subject,
            html: email.html,
            text: email.text,
            ...(options.replyTo ? { reply_to: options.replyTo } : {}),
          }),
          Effect.mapError(
            (e) =>
              new MailerError({
                message: `Resend: could not encode (${e.reason._tag})`,
                retryable: false,
              }),
          ),
          Effect.flatMap((req) => client.execute(req)),
          Effect.mapError((e) =>
            e instanceof MailerError
              ? e
              : new MailerError({ message: `Resend: ${e.message}`, retryable: true }),
          ),
          Effect.flatMap((res) =>
            res.status >= 200 && res.status < 300
              ? HttpClientResponse.schemaBodyJson(SentWire)(res).pipe(
                  Effect.map((b) => b.id as string | undefined),
                  Effect.orElseSucceed(() => undefined),
                )
              : res.json.pipe(
                  Effect.orElseSucceed(() => ({})),
                  Effect.flatMap((body) =>
                    Schema.decodeUnknown(ErrorWire)(body).pipe(
                      Effect.orElseSucceed(() => ({}) as typeof ErrorWire.Type),
                    ),
                  ),
                  Effect.flatMap(
                    (body) =>
                      new MailerError({
                        message: `Resend ${res.status}: ${body.message ?? body.error ?? body.name ?? 'error'}`,
                        retryable: res.status === 429 || res.status >= 500,
                        status: res.status,
                      }),
                  ),
                ),
          ),
          Effect.scoped,
          Effect.timeoutFail({
            duration: '15 seconds',
            onTimeout: () =>
              new MailerError({
                message: 'Resend: no response within 15 seconds',
                retryable: true,
              }),
          }),
        ),
    }
    return service
  })

export const layerResend = (options: ResendOptions) => Layer.effect(Mailer, makeResend(options))
