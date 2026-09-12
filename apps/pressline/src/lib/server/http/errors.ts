import { DesignNotFound } from '@pressline/contract';
import { Effect } from 'effect';
import type { CatalogError } from '../catalog/catalog';
import type { DesignSourceError, UnknownEngine } from '../services/design-source';
import type { FulfillmentProviderError } from '../services/fulfillment-provider';
import { CatalogUnavailable, EngineError } from './api';

type DomainFailure = UnknownEngine | DesignSourceError | CatalogError | FulfillmentProviderError;

const DOMAIN_TAGS: ReadonlySet<string> = new Set([
  'UnknownEngine',
  'DesignSourceError',
  'CatalogError',
  'FulfillmentProviderError',
]);

const isDomainFailure = <E extends { readonly _tag: string }>(
  e: E | DomainFailure,
): e is DomainFailure => DOMAIN_TAGS.has(e._tag);

const mapDomainFailure = (designId: string, e: DomainFailure) => {
  switch (e._tag) {
    // An Engine that is not configured looks, to the public, like a missing design.
    case 'UnknownEngine':
      return new DesignNotFound({ designId });
    case 'DesignSourceError':
      return new EngineError({ engine: e.engine, message: e.message });
    case 'CatalogError':
      return new CatalogUnavailable({
        message: `Offer "${e.offer}": ${e.message}`,
        offer: e.offer,
      });
    case 'FulfillmentProviderError':
      return new CatalogUnavailable({ message: e.message });
  }
};

/**
 * One mapping from domain failures to API errors, shared by every endpoint
 * that reaches an Engine or the Catalog. Errors that already are API errors
 * (DesignNotFound, EngineUnavailable, PrintfileUnavailable) pass through.
 */
export const toApiError = <A, E extends { readonly _tag: string }, R>(
  designId: string,
  effect: Effect.Effect<A, E | DomainFailure, R>,
): Effect.Effect<
  A,
  Exclude<E, DomainFailure> | DesignNotFound | EngineError | CatalogUnavailable,
  R
> =>
  effect.pipe(
    Effect.catchIf(isDomainFailure<E>, (e) => Effect.fail(mapDomainFailure(designId, e))),
  ) as Effect.Effect<
    A,
    Exclude<E, DomainFailure> | DesignNotFound | EngineError | CatalogUnavailable,
    R
  >;
