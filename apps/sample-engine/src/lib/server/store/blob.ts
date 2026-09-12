import { get, head, put } from '@vercel/blob'
import type { FileStore } from './file-store.js'

/** Vercel Blob (`BLOB_READ_WRITE_TOKEN`): public, and the key is the path so URLs are stable. */
export const blobStore = (token: string): FileStore => {
  const urls = new Map<string, string>()
  return {
    name: 'blob',
    urlFor: (key) => urls.get(key) ?? key,
    put: async (key, bytes, contentType) => {
      const existing = await head(key, { token }).catch(() => undefined)
      if (existing) {
        urls.set(key, existing.url)
        return existing.url
      }
      // Keys are content-addressed (design id + Spec Hash), so a racing second writer
      // stores the same bytes; allowing the overwrite avoids a 500 for it.
      const res = await put(key, new Blob([bytes as BlobPart]), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType,
        token,
      })
      urls.set(key, res.url)
      return res.url
    },
    overwrite: async (key, bytes, contentType) => {
      const res = await put(key, new Blob([bytes as BlobPart]), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType,
        token,
      })
      urls.set(key, res.url)
    },
    get: async (key) => {
      // Straight from origin storage, never the CDN: the Design record is overwritten as
      // Printfiles are added, and a cached copy read back would drop them on the next write.
      const found = await get(key, { access: 'public', useCache: false, token }).catch(() => null)
      if (!found) return undefined
      return new Uint8Array(await new Response(found.stream).arrayBuffer())
    },
  }
}
