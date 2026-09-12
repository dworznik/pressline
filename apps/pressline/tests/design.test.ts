import type { DesignResponse } from '@pressline/contract';
import { afterEach, describe, expect, it } from 'vitest';
import type { DesignPage } from '$lib/server/http/api';
import { catalog, offers } from './fixtures/catalog';
import { makeTestApp, type TestApp } from './harness';

const portrait: DesignResponse = {
  id: 'design-portrait-1',
  title: 'Blue heron',
  sellable: true,
  previewUrl: 'https://engine.test/p/heron.png',
  aspect: { w: 3, h: 4 },
};
const square: DesignResponse = {
  id: 'design-square-01',
  sellable: true,
  previewUrl: 'https://engine.test/p/sq.png',
  aspect: { w: 1, h: 1 },
};
const teeOnly: DesignResponse = {
  ...portrait,
  id: 'design-tee-only1',
  offers: ['tee-black-front'],
};
const withdrawn: DesignResponse = { ...portrait, id: 'design-withdrawn', sellable: false };

const engines = {
  engines: {
    sample: {
      designs: {
        [portrait.id]: portrait,
        [square.id]: square,
        [teeOnly.id]: teeOnly,
        [withdrawn.id]: withdrawn,
      },
    },
  },
};

describe('GET /api/designs/{engine}/{designId} (Storefront design page data)', () => {
  let app: TestApp;
  afterEach(() => app?.dispose());

  it('returns the Design with its Preview hot-linked and every eligible Offer', async () => {
    app = await makeTestApp({ config: { catalog: { offers } }, catalog, engines });
    const { status, body } = await app.json<DesignPage>(`/api/designs/sample/${portrait.id}`);
    expect(status).toBe(200);
    expect(body.design).toMatchObject({
      id: portrait.id,
      title: 'Blue heron',
      previewUrl: portrait.previewUrl,
    });
    expect(body.offers.map((o) => o.slug).sort()).toEqual(['poster-18x24', 'tee-black-front']);
    expect(body.offers[0]!.variants[0]!.spec).toBeDefined();
  });

  it('filters Offers by the aspect range: a square design cannot go on the 3:4 poster', async () => {
    app = await makeTestApp({ config: { catalog: { offers } }, catalog, engines });
    const { body } = await app.json<DesignPage>(`/api/designs/sample/${square.id}`);
    expect(body.offers.map((o) => o.slug)).toEqual(['tee-black-front']);
  });

  it('filters Offers by the Engine’s eligibility list', async () => {
    app = await makeTestApp({ config: { catalog: { offers } }, catalog, engines });
    const { body } = await app.json<DesignPage>(`/api/designs/sample/${teeOnly.id}`);
    expect(body.offers.map((o) => o.slug)).toEqual(['tee-black-front']);
  });

  it('404s an unknown design, and an unknown Engine looks the same', async () => {
    app = await makeTestApp({ config: { catalog: { offers } }, catalog, engines });
    expect((await app.fetch('/api/designs/sample/design-nope-0000')).status).toBe(404);
    expect((await app.fetch(`/api/designs/other/${portrait.id}`)).status).toBe(404);
  });

  it('returns a not-sellable design with no Offers', async () => {
    app = await makeTestApp({ config: { catalog: { offers } }, catalog, engines });
    const { status, body } = await app.json<DesignPage>(`/api/designs/sample/${withdrawn.id}`);
    expect(status).toBe(200);
    expect(body.design.sellable).toBe(false);
    expect(body.offers).toEqual([]);
  });

  it('503s when the Engine was disabled at startup', async () => {
    app = await makeTestApp({
      config: { catalog: { offers } },
      catalog,
      engines: {
        engines: { sample: { protocolVersion: '9', designs: { [portrait.id]: portrait } } },
      },
    });
    const { status, body } = await app.json<{ reason: string }>(
      `/api/designs/sample/${portrait.id}`,
    );
    expect(status).toBe(503);
    expect(body.reason).toMatch(/protocol version 9/);
  });
});
