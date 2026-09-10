import { HttpApiBuilder, HttpServerRequest } from '@effect/platform';
import { Effect } from 'effect';
import { WebhookRejected } from '../services/psp';
import { handleStripeWebhook } from '../webhooks/stripe';
import { PresslineApi } from './api';

/** `POST /webhooks/stripe`: verify, record, re-fetch, transition. The raw body is read here because the signature covers its exact bytes. */
export const WebhooksLive = HttpApiBuilder.group(PresslineApi, 'webhooks', (handlers) =>
  handlers.handle('stripe', ({ headers }) =>
    Effect.gen(function* () {
      const req = yield* HttpServerRequest.HttpServerRequest;
      const rawBody = yield* req.text.pipe(
        Effect.mapError(() => new WebhookRejected({ message: 'unreadable body' })),
      );
      return yield* handleStripeWebhook(rawBody, headers['stripe-signature']);
    }),
  ),
);
