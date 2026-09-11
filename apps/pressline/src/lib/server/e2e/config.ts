import type { PresslineConfigSchema } from '../config/schema';

/** The Operator config the Playwright build runs with; plain data, safe to import anywhere. */
export const e2eConfig: Partial<typeof PresslineConfigSchema.Encoded> = {
  name: 'E2E Shop',
  currency: 'EUR',
  engines: [{ slug: 'sample', baseUrl: 'http://localhost:5174' }],
  branding: { accent: '#0a7d5a', accentText: '#ffffff', tagline: 'Prints from your designs' },
  legal: {
    termsUrl: 'https://shop.e2e/terms',
    privacyUrl: 'https://shop.e2e/privacy',
    contactEmail: 'hello@shop.e2e',
  },
  checkout: { publicUrl: 'http://localhost:4173' },
  catalogue: {
    offers: [
      {
        slug: 'tee-black-front',
        name: 'Black tee, front print',
        catalogProductId: 71,
        placement: 'front',
        technique: 'dtg',
        retailPrice: 2500,
        variants: {
          'black-m': {
            catalogVariantId: 4017,
            label: 'Black / M',
            color: 'Black',
            size: 'M',
            imageUrl: 'https://files.e2e/tee-black.png',
          },
        },
      },
    ],
  },
};
