import { error, type RequestHandler } from '@sveltejs/kit'
import { getRuntime } from '$lib/server/runtime'

const TYPES: Record<string, string> = {
  png: 'image/png',
  json: 'application/json',
  jpg: 'image/jpeg',
}

/** Only what Pressline hot-links is public; metadata and AI sources are not. */
const PUBLIC = /^(previews|printfiles)\//

/** Serves the fs FileStore's files with Range support (Pressline reads Printfile headers with a ranged GET). */
export const GET: RequestHandler = async ({ params, platform, request }) => {
  const key = params.path ?? ''
  if (!PUBLIC.test(key) || key.includes('..')) error(404, 'no such file')
  const { engine } = await getRuntime(platform)
  const bytes = await engine.store.get(key).catch(() => undefined)
  if (!bytes) error(404, 'no such file')
  const type = TYPES[key.split('.').pop() ?? ''] ?? 'application/octet-stream'
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') ?? '')
  const headers: Record<string, string> = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=31536000, immutable',
  }
  if (range) {
    const start = Number(range[1])
    const end = Math.min(range[2] ? Number(range[2]) : bytes.length - 1, bytes.length - 1)
    if (start > end) {
      return new Response(null, {
        status: 416,
        headers: { 'content-range': `bytes */${bytes.length}` },
      })
    }
    const slice = bytes.slice(start, end + 1)
    return new Response(new Blob([slice as BlobPart]), {
      status: 206,
      headers: {
        ...headers,
        'content-range': `bytes ${start}-${end}/${bytes.length}`,
        'content-length': String(slice.length),
      },
    })
  }
  return new Response(new Blob([bytes as BlobPart]), {
    headers: { ...headers, 'content-length': String(bytes.length) },
  })
}
