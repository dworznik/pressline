import { readFileSync } from 'node:fs'
import { FetchHttpClient } from '@effect/platform'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { Mailer, MailerError } from '$lib/server/services/mailer'
import { layerResend } from '$lib/server/services/resend'

/** Seam 2: the Resend adapter against a replaying stub. */
const seen: {
  url: string
  auth: string | null
  idem: string | null
  body: Record<string, unknown>
}[] = []
let forceStatus: number | undefined

const stubFetch: typeof fetch = async (input, init) => {
  const req = new Request(input, init)
  seen.push({
    url: req.url,
    auth: req.headers.get('authorization'),
    idem: req.headers.get('idempotency-key'),
    body: (await req.json()) as Record<string, unknown>,
  })
  if (forceStatus)
    return Response.json(
      { statusCode: forceStatus, message: 'forced', name: 'x' },
      { status: forceStatus },
    )
  return new Response(
    readFileSync(new URL('./fixtures/resend/sent.json', import.meta.url), 'utf8'),
    {
      headers: { 'content-type': 'application/json' },
    },
  )
}

const layer = layerResend({
  apiKey: 're_fixture',
  from: 'Test Shop <orders@shop.test>',
  replyTo: 'help@shop.test',
}).pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(Layer.succeed(FetchHttpClient.Fetch, stubFetch)),
)
const send = Effect.flatMap(Mailer, (m) =>
  m.send({
    to: 'anna@example.com',
    subject: 'Hi',
    html: '<p>Hi</p>',
    text: 'Hi',
    idempotencyKey: 'order-1:confirmation',
  }),
)

describe('Resend adapter', () => {
  it('posts one email with sender, reply-to and idempotency key, and returns the message id', async () => {
    const id = await Effect.runPromise(send.pipe(Effect.provide(layer)))
    expect(id).toBe('49a3999c-0ce1-4ea6-ab68-afcd6dc2e794')
    const req = seen.at(-1)!
    expect(req.url).toBe('https://api.resend.com/emails')
    expect(req.auth).toBe('Bearer re_fixture')
    expect(req.idem).toBe('order-1:confirmation')
    expect(req.body).toEqual({
      from: 'Test Shop <orders@shop.test>',
      to: ['anna@example.com'],
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
      reply_to: 'help@shop.test',
    })
  })

  it('maps errors: 422 not retryable, 429 retryable', async () => {
    forceStatus = 422
    const bad = await Effect.runPromise(send.pipe(Effect.flip, Effect.provide(layer)))
    forceStatus = 429
    const limited = await Effect.runPromise(send.pipe(Effect.flip, Effect.provide(layer)))
    forceStatus = undefined
    expect(bad).toBeInstanceOf(MailerError)
    expect(bad).toMatchObject({ retryable: false, status: 422 })
    expect(limited).toMatchObject({ retryable: true, status: 429 })
  })
})
