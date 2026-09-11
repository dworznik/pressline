import { error, type RequestHandler } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';

const TYPES: Record<string, string> = {
  png: 'image/png',
  json: 'application/json',
  jpg: 'image/jpeg',
};

/** Serves the fs FileStore's files with Range support (Pressline reads Printfile headers with a ranged GET). */
export const GET: RequestHandler = async ({ params, platform, request }) => {
  const { engine } = await getRuntime(platform);
  const key = params.path ?? '';
  const bytes = await engine.store.get(key);
  if (!bytes) error(404, 'no such file');
  const type = TYPES[key.split('.').pop() ?? ''] ?? 'application/octet-stream';
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') ?? '');
  const headers: Record<string, string> = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=31536000, immutable',
  };
  if (range) {
    const start = Number(range[1]);
    const end = Math.min(range[2] ? Number(range[2]) : bytes.length - 1, bytes.length - 1);
    const slice = bytes.slice(start, end + 1);
    return new Response(new Blob([slice as BlobPart]), {
      status: 206,
      headers: {
        ...headers,
        'content-range': `bytes ${start}-${end}/${bytes.length}`,
        'content-length': String(slice.length),
      },
    });
  }
  return new Response(new Blob([bytes as BlobPart]), {
    headers: { ...headers, 'content-length': String(bytes.length) },
  });
};
