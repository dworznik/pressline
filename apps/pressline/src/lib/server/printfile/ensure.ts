import type { CatalogueVariant, PrintfileReady } from '@pressline/contract';
import { Clock, Duration, Effect, Option, Schema } from 'effect';
import { Config } from '../config/schema';
import { Db } from '../db/db';
import { loadDesign } from '../design/design';
import { DesignSource } from '../services/design-source';
import { PrintfileInvalid, validatePrintfile } from './validate';

/** Why this Design cannot be ordered on this Offer/variant right now (422). */
export class PrintfileUnavailable extends Schema.TaggedError<PrintfileUnavailable>()(
  'PrintfileUnavailable',
  {
    reason: Schema.Literal('not_sellable', 'not_eligible', 'rejected', 'invalid'),
    message: Schema.String,
  },
) {}

export const StoredPrintfile = Schema.Struct({
  url: Schema.String,
  sha256: Schema.String,
  width: Schema.Int,
  height: Schema.Int,
  bytes: Schema.Int,
  contentType: Schema.Literal('image/png', 'image/jpeg'),
  specHash: Schema.String,
});
export type StoredPrintfile = typeof StoredPrintfile.Type;

export type PrintfileState =
  | { readonly status: 'ready'; readonly printfile: StoredPrintfile }
  | { readonly status: 'preparing'; readonly retryAfterMs: number };

/** Engines may ask for faster polling, but the bridge never hammers them. */
export const MIN_RETRY_AFTER_MS = 250;
/** Wall-clock cap on one ensure call beyond the configured wait: one Engine round trip plus the validation fetch. */
export const GRACE_MS = 15_000;

export interface EnsureRequest {
  readonly engine: string;
  readonly designId: string;
  readonly offer: string;
  readonly variant: string;
  /** Wait (up to the configured bound) for a rendering Engine, or answer `preparing` at once. */
  readonly wait: boolean;
}

type Row = {
  url: string;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
  content_type: 'image/png' | 'image/jpeg';
  spec_hash: string;
};

/** The validated Printfile stored for (Engine, Design, Spec Hash), if any. */
export const findStored = (engine: string, designId: string, specHash: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rows = yield* db.all<Row>(
      'SELECT url, sha256, width, height, bytes, content_type, spec_hash FROM printfiles WHERE engine = ? AND design_id = ? AND spec_hash = ?',
      [engine, designId, specHash],
    );
    const r = rows[0];
    return r
      ? ({
          url: r.url,
          sha256: r.sha256,
          width: r.width,
          height: r.height,
          bytes: r.bytes,
          contentType: r.content_type,
          specHash: r.spec_hash,
        } satisfies StoredPrintfile)
      : undefined;
  }).pipe(Effect.orDie);

const store = (req: EnsureRequest, ready: PrintfileReady) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const now = yield* Clock.currentTimeMillis;
    yield* db.run(
      `INSERT OR REPLACE INTO printfiles
         (engine, design_id, spec_hash, url, sha256, width, height, bytes, content_type, validated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.engine,
        req.designId,
        ready.specHash,
        ready.url,
        ready.sha256,
        ready.width,
        ready.height,
        ready.bytes,
        ready.contentType,
        now,
      ],
    );
  }).pipe(Effect.orDie);

const recordRejection = (req: EnsureRequest, code: string, message: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const now = yield* Clock.currentTimeMillis;
    yield* db.run(
      `INSERT OR REPLACE INTO printfile_rejections (engine, design_id, offer_slug, code, message, rejected_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.engine, req.designId, req.offer, code, message, now],
    );
  }).pipe(Effect.orDie);

/**
 * Ensure a validated Printfile exists for (Design, Offer variant) — ADR-0004,
 * ADR-0005. Idempotent on (Engine, Design ID, Spec Hash): a stored Printfile
 * is returned without asking the Engine. Otherwise the Engine is asked and,
 * while it answers `rendering`, polled within the wait bound; a `ready`
 * answer is validated by its headers before being stored.
 */
export const ensurePrintfile = (req: EnsureRequest) =>
  Effect.gen(function* () {
    const page = yield* loadDesign(req.engine, req.designId);
    if (!page.design.sellable) {
      return yield* new PrintfileUnavailable({
        reason: 'not_sellable',
        message: 'This design is no longer available to order.',
      });
    }
    const offer = page.offers.find((o) => o.slug === req.offer);
    const variant: CatalogueVariant | undefined = offer?.variants.find(
      (v) => v.key === req.variant,
    );
    if (!offer || !variant) {
      return yield* new PrintfileUnavailable({
        reason: 'not_eligible',
        message: 'This product is not available for this design.',
      });
    }

    const stored = yield* findStored(req.engine, req.designId, variant.specHash);
    if (stored) return { status: 'ready', printfile: stored } satisfies PrintfileState;

    const config = yield* Config;
    const source = yield* DesignSource;
    const budgetMs = req.wait ? config.printfile.waitMs : 0;
    const startedAt = yield* Clock.currentTimeMillis;

    const loop = Effect.gen(function* () {
      while (true) {
        const answer = yield* source.ensurePrintfile(req.engine, req.designId, variant.spec);
        if (answer.status === 'ready') {
          yield* validatePrintfile(answer, variant.spec, variant.specHash);
          yield* store(req, answer);
          return { status: 'ready', printfile: answer } satisfies PrintfileState;
        }
        const retryAfterMs = Math.max(MIN_RETRY_AFTER_MS, answer.retryAfterMs);
        const elapsed = (yield* Clock.currentTimeMillis) - startedAt;
        if (elapsed + retryAfterMs > budgetMs) {
          return { status: 'preparing', retryAfterMs } satisfies PrintfileState;
        }
        yield* Effect.sleep(retryAfterMs);
      }
    });
    // Sleeps are bounded by the budget; the Engine call and the validation
    // fetch are bounded here, so wall time never exceeds budget + GRACE_MS.
    const outcome = yield* loop.pipe(Effect.timeoutOption(Duration.millis(budgetMs + GRACE_MS)));
    return Option.getOrElse(
      outcome,
      () => ({ status: 'preparing', retryAfterMs: 1000 }) satisfies PrintfileState,
    );
  }).pipe(
    Effect.catchTag('PrintfileRejected', (e) =>
      recordRejection(req, e.code, e.message).pipe(
        Effect.flatMap(
          () =>
            new PrintfileUnavailable({
              reason: 'rejected',
              message: `This design cannot be printed on this product (${e.code}: ${e.message}).`,
            }),
        ),
      ),
    ),
    Effect.catchTags({
      PrintfileInvalid: (e) =>
        new PrintfileUnavailable({
          reason: 'invalid',
          message: `The design app produced a file that does not match the print specification (${e.reason}: ${e.message}).`,
        }),
    }),
  );

export { PrintfileInvalid };
