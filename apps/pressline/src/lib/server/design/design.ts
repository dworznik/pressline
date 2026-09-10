import type { CatalogueOffer, DesignResponse } from '@pressline/contract';
import { Effect, Schema } from 'effect';
import { resolveCatalogue } from '../catalogue/catalogue';
import { DesignSource } from '../services/design-source';
import { Engines } from './engines';

/** The configured Engine is disabled (protocol mismatch or unreachable at startup). */
export class EngineUnavailable extends Schema.TaggedError<EngineUnavailable>()(
  'EngineUnavailable',
  { engine: Schema.String, reason: Schema.String },
) {}

/**
 * Eligibility (CONTEXT.md): Catalogue ∩ the Offer slugs the Engine lists for
 * the Design (absent = all) ∩ Offers whose aspect range accepts the Design.
 */
export const eligibleOffers = (
  design: DesignResponse,
  offers: ReadonlyArray<CatalogueOffer>,
): ReadonlyArray<CatalogueOffer> => {
  const ratio = design.aspect.w / design.aspect.h;
  const listed = design.offers ? new Set(design.offers) : undefined;
  return offers.filter(
    (o) =>
      (listed === undefined || listed.has(o.slug)) &&
      (o.aspect === null || (ratio >= o.aspect.min && ratio <= o.aspect.max)),
  );
};

/** A Design as the Storefront sees it: the Engine's answer plus what can be bought. */
export const loadDesign = (engine: string, designId: string) =>
  Effect.gen(function* () {
    const status = yield* Effect.flatMap(Engines, (e) => e.get(engine));
    if (status && !status.enabled) {
      return yield* new EngineUnavailable({ engine, reason: status.reason ?? 'disabled' });
    }
    const source = yield* DesignSource;
    const design = yield* source.getDesign(engine, designId);
    const catalogue = yield* resolveCatalogue;
    return {
      engine,
      design,
      offers: design.sellable ? eligibleOffers(design, catalogue.offers) : [],
      currency: catalogue.currency,
    };
  });
