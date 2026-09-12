import { FetchHttpClient } from '@effect/platform'
import type { DesignResponse } from '@pressline/contract'
import { Effect, Layer } from 'effect'
import { makeHostedFetch, type HostedFile } from './hosted'
import { png } from './png'
import {
  makeDesignSourceMemory,
  makeFulfillmentProviderMemory,
  makePspMemory,
  type MemoryCatalog,
} from '../services/memory'
import { layerMailerNone } from '../services/mailer'

/**
 * The world the Playwright e2e run sees (ticket #19): in-memory Engine, provider
 * and PSP seeded with a few designs and one product, plus the "hosted" files
 * the Printfile validator fetches. Everything else is the real bridge.
 * Enabled by `PRESSLINE_E2E=1`; never in a real deployment.
 */
export const E2E_FILE = 'https://engine.e2e/files/sunset/front.png'

const designs: Record<string, DesignResponse> = {
  'sunset-1': {
    id: 'sunset-1',
    title: 'Sunset study',
    sellable: true,
    previewUrl: 'https://files.e2e/sunset.png',
    aspect: { w: 3, h: 4 },
  },
  'sunset-slow': {
    id: 'sunset-slow',
    title: 'Slow sunset',
    sellable: true,
    previewUrl: 'https://files.e2e/sunset.png',
    aspect: { w: 3, h: 4 },
  },
  'sunset-mockup': {
    id: 'sunset-mockup',
    title: 'Sunset with mockup',
    sellable: true,
    previewUrl: 'https://files.e2e/sunset.png',
    aspect: { w: 3, h: 4 },
    mockups: { 'tee-black-front': 'https://files.e2e/sunset-on-tee.png' },
  },
}

const catalog: MemoryCatalog = {
  products: [
    {
      id: 71,
      name: 'Unisex Staple T-Shirt | Bella + Canvas 3001',
      printMethods: [{ placement: 'front', technique: 'dtg' }],
    },
  ],
  variants: [
    {
      id: 4017,
      catalogProductId: 71,
      name: 'Bella + Canvas 3001 (Black / M)',
      size: 'M',
      color: 'Black',
      placementDimensions: [{ placement: 'front', widthIn: 12, heightIn: 16, orientation: 'any' }],
    },
  ],
  printAreas: {
    71: [
      {
        placement: 'front',
        technique: 'dtg',
        printAreaWidthIn: 12,
        printAreaHeightIn: 16,
        dpi: 150,
      },
    ],
  },
  shippingRates: {
    DE: [
      {
        method: 'STANDARD',
        name: 'Standard',
        rate: { amount: 479, currency: 'EUR' },
        minDeliveryDays: 3,
        maxDeliveryDays: 6,
      },
    ],
  },
  prices: { 4017: { currency: 'EUR', byTechnique: { dtg: 1090 }, placementSurcharge: {} } },
}

const files: Record<string, HostedFile> = {
  [E2E_FILE]: {
    bytes: png({ width: 1800, height: 2400, totalBytes: 5000 }),
    contentType: 'image/png',
  },
}

/** Memory services for the e2e run; the PSP's hosted page is the success URL itself. */
export const e2eServices = Layer.unwrapEffect(
  Effect.gen(function* () {
    const designSource = yield* makeDesignSourceMemory({
      engines: {
        sample: {
          designs,
          printfiles: {
            'sunset-1': { kind: 'ready', url: E2E_FILE, bytes: 5000 },
            'sunset-mockup': { kind: 'ready', url: E2E_FILE, bytes: 5000 },
            'sunset-slow': {
              kind: 'rendering',
              times: 3,
              retryAfterMs: 300,
              next: { kind: 'ready', url: E2E_FILE, bytes: 5000 },
            },
          },
        },
      },
    })
    const provider = yield* makeFulfillmentProviderMemory(catalog)
    const psp = yield* makePspMemory({ hostedPage: 'success' })
    return Layer.mergeAll(
      designSource.layer,
      provider.layer,
      psp.layer,
      layerMailerNone,
      FetchHttpClient.layer.pipe(
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, makeHostedFetch(files, new Map()))),
      ),
    )
  }),
)
