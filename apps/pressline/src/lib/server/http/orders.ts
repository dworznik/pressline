import { HttpApiBuilder, HttpServerRequest } from '@effect/platform';
import { Effect } from 'effect';
import { startCheckout } from '../checkout/checkout';
import { publicOrder } from '../orders/public';
import { PresslineApi, PspUnavailable } from './api';
import { toApiError } from './errors';

/**
 * Public origin for PSP return URLs when `checkout.publicUrl` is not set:
 * the proxy's forwarded host if present, else the Host header; https unless
 * it is plainly local.
 */
const originOf = (req: HttpServerRequest.HttpServerRequest) => {
  const forwardedHost = req.headers['x-forwarded-host'];
  if (forwardedHost) return `${req.headers['x-forwarded-proto'] ?? 'https'}://${forwardedHost}`;
  const source = req.source;
  if (source instanceof Request) return new URL(source.url).origin;
  return `https://${req.headers['host'] ?? 'localhost'}`;
};

/** `POST /api/checkout` starts a PSP session for a Quote; `GET /api/orders/{id}?t=` is the token-gated status. */
export const OrdersLive = HttpApiBuilder.group(PresslineApi, 'orders', (handlers) =>
  handlers
    .handle('checkout', ({ payload }) =>
      Effect.gen(function* () {
        const req = yield* HttpServerRequest.HttpServerRequest;
        return yield* startCheckout(payload, originOf(req));
      }).pipe(
        Effect.catchTag('PspError', (e) => new PspUnavailable({ message: e.message })),
        (eff) => toApiError('', eff),
      ),
    )
    .handle('publicOrder', ({ path, urlParams }) => publicOrder(path.id, urlParams.t)),
);
