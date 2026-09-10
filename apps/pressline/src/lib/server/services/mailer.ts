import { Context, Effect, Layer, Ref, Schema } from 'effect';

/**
 * Mailer (CONTEXT.md): delivers Customer emails. Resend is the shipped
 * implementation (ticket #12); `none` and `console` exist for setup and dev;
 * the memory mailer records sends so HTTP-seam tests can assert on them.
 */
export class MailerError extends Schema.TaggedError<MailerError>()('MailerError', {
  message: Schema.String,
}) {}

export interface Email {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface MailerService {
  readonly send: (email: Email) => Effect.Effect<void, MailerError>;
}

export class Mailer extends Context.Tag('pressline/Mailer')<Mailer, MailerService>() {}

export const layerMailerNone = Layer.succeed(Mailer, { send: () => Effect.void });

export const layerMailerConsole = Layer.succeed(Mailer, {
  send: (email) =>
    Effect.sync(() => console.warn(`[mail] to=${email.to} subject=${email.subject}`)),
});

/** Memory mailer: `make` returns the layer and a handle to read what was sent. */
export const makeMailerMemory = Effect.map(Ref.make<ReadonlyArray<Email>>([]), (ref) => ({
  layer: Layer.succeed(Mailer, {
    send: (email) => Ref.update(ref, (sent) => [...sent, email]),
  }),
  sent: Ref.get(ref),
}));
