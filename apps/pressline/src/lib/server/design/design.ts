import type { CatalogueOffer, DesignResponse } from '@pressline/contract';
import { Effect, Schema } from 'effect';
import { resolveCatalogue } from '../catalogue/catalogue';
import { STRIPE_TEST_CARD } from '../config/demo';
import { Config } from '../config/schema';
import { Db } from '../db/db';
import { DesignSource } from '../services/design-source';
import { Engines } from './engines';

/** The configured Engine is disabled (protocol mismatch or unreachable). */
export class EngineUnavailable extends Schema.TaggedError<EngineUnavailable>()(
  'EngineUnavailable',
  { engine: Schema.String, reason: Schema.String },
) {}

/**
 * Eligibility (CONTEXT.md): Catalogue ∩ the Offer slugs the Engine lists for
 * the Design (absent = all) ∩ Offers whose aspect range accepts the Design ∩
 * Offers the Engine has not rejected for this Design (ticket #6).
 */
export const eligibleOffers = (
  design: DesignResponse,
  offers: ReadonlyArray<CatalogueOffer>,
  rejected: ReadonlySet<string> = new Set(),
): ReadonlyArray<CatalogueOffer> => {
  const ratio = design.aspect.w / design.aspect.h;
  const listed = design.offers ? new Set(design.offers) : undefined;
  return offers.filter(
    (o) =>
      (listed === undefined || listed.has(o.slug)) &&
      !rejected.has(o.slug) &&
      (o.aspect === null || (ratio >= o.aspect.min && ratio <= o.aspect.max)),
  );
};

const rejectedOffers = (engine: string, designId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rows = yield* db.all<{ offer_slug: string }>(
      'SELECT offer_slug FROM printfile_rejections WHERE engine = ? AND design_id = ?',
      [engine, designId],
    );
    return new Set(rows.map((r) => r.offer_slug));
  }).pipe(Effect.orDie);

/** A Design as the Storefront sees it: the Engine's answer plus what can be bought. */
export const loadDesign = (engine: string, designId: string) =>
  Effect.gen(function* () {
    const engines = yield* Engines;
    const status = yield* engines.recheck(engine);
    if (status && !status.enabled) {
      return yield* new EngineUnavailable({ engine, reason: status.reason ?? 'disabled' });
    }
    const source = yield* DesignSource;
    const design = yield* source.getDesign(engine, designId);
    const catalogue = yield* resolveCatalogue;
    const rejected = yield* rejectedOffers(engine, designId);
    const config = yield* Config;
    return {
      engine,
      design,
      offers: design.sellable ? eligibleOffers(design, catalogue.offers, rejected) : [],
      currency: catalogue.currency,
      storefront: {
        name: config.name,
        ...(config.branding.logoUrl ? { logoUrl: config.branding.logoUrl } : {}),
        accent: config.branding.accent,
        accentText: config.branding.accentText,
        ...(config.demo ? { demo: { testCard: STRIPE_TEST_CARD } } : {}),
        withdrawalNotice: config.legal.withdrawalNotice,
        ...(config.legal.termsUrl ? { termsUrl: config.legal.termsUrl } : {}),
        ...(config.legal.privacyUrl ? { privacyUrl: config.legal.privacyUrl } : {}),
        ...(config.legal.contactEmail ? { contactEmail: config.legal.contactEmail } : {}),
      },
    };
  });
