import { Context, Effect, Layer, Schema } from 'effect';

/**
 * Mailer (CONTEXT.md): delivers Customer emails. Resend is the shipped
 * implementation (ticket #12); `none` and `console` exist for setup and dev.
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

/** Sends nothing. The production default until a real Mailer is configured. */
export const layerMailerNone = Layer.succeed(Mailer, { send: () => Effect.void });

/**
 * Dev-only stand-in. Logs an opaque delivery event: never the recipient or
 * the subject (CWE-532), because logs outlive the request and the Recipient
 * is the only personal data Pressline holds.
 */
export const layerMailerConsole = Layer.succeed(Mailer, {
  send: (email) =>
    Effect.sync(() => console.warn(`[mail] delivered 1 message (${email.html.length} bytes html)`)),
});
