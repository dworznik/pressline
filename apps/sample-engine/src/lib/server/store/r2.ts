import type { FileStore } from './file-store.js';

/** Cloudflare R2 via the Worker binding; the bucket has a public custom domain or r2.dev URL. */
export const r2Store = (bucket: R2Bucket, publicOrigin: string): FileStore => ({
  name: 'r2',
  urlFor: (key) => `${publicOrigin.replace(/\/$/, '')}/${key}`,
  put: async (key, bytes, contentType) => {
    if (!(await bucket.head(key))) {
      await bucket.put(key, bytes, { httpMetadata: { contentType } });
    }
    return `${publicOrigin.replace(/\/$/, '')}/${key}`;
  },
  overwrite: async (key, bytes, contentType) => {
    await bucket.put(key, bytes, { httpMetadata: { contentType } });
  },
  get: async (key) => {
    const obj = await bucket.get(key);
    return obj ? new Uint8Array(await obj.arrayBuffer()) : undefined;
  },
});
