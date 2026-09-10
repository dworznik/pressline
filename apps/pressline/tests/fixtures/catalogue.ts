import type { MemoryCatalog } from '$lib/server/services/memory';

/** Provider-side catalog the Operator's Offers point at (shapes as the adapter returns them). */
export const catalog: MemoryCatalog = {
  products: [
    {
      id: 71,
      name: 'Unisex Staple T-Shirt | Bella + Canvas 3001',
      printMethods: [
        { placement: 'front', technique: 'dtg' },
        { placement: 'back', technique: 'dtg' },
      ],
    },
    {
      id: 1,
      name: 'Enhanced Matte Paper Poster (in)',
      printMethods: [{ placement: 'default', technique: 'digital' }],
    },
  ],
  variants: [
    {
      id: 4017,
      catalogProductId: 71,
      name: 'Bella + Canvas 3001 (Black / M)',
      size: 'M',
      color: 'Black',
      imageUrl: 'https://files.test/4017.jpg',
      placementDimensions: [{ placement: 'front', widthIn: 12, heightIn: 16, orientation: 'any' }],
    },
    {
      id: 1349,
      catalogProductId: 1,
      name: 'Poster 18×24',
      size: '18″×24″',
      placementDimensions: [
        { placement: 'default', widthIn: 18, heightIn: 24, orientation: 'vertical' },
      ],
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
    1: [
      {
        placement: 'default',
        technique: 'digital',
        printAreaWidthIn: 18,
        printAreaHeightIn: 24,
        dpi: 150,
      },
    ],
  },
};

/** Operator config matching the catalog above. */
export const offers = [
  {
    slug: 'tee-black-front',
    name: 'Black tee, front print',
    catalogProductId: 71,
    placement: 'front',
    technique: 'dtg',
    retailPrice: 2500,
    variants: { 'black-m': { catalogVariantId: 4017, label: 'Black / M' } },
  },
  {
    slug: 'poster-18x24',
    name: 'Matte poster 18×24',
    catalogProductId: 1,
    placement: 'default',
    technique: 'digital',
    retailPrice: 1900,
    aspect: { min: 0.7, max: 0.8 },
    variants: { '18x24': { catalogVariantId: 1349, label: '18×24 in' } },
  },
];
