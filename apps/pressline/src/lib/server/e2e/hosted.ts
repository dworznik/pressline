/** Files an Engine "hosts" in tests and the e2e seed: what a ranged GET of a Printfile URL returns. */
export interface HostedFile {
  readonly bytes: Uint8Array
  readonly contentType: string
  /** Answer with this status instead of serving the file. */
  readonly status?: number
  /** Ignore Range and answer 200 with the whole body. */
  readonly ignoreRange?: boolean
}

/** Serves the harness's hosted files with Range support; anything else is 404. */
export const makeHostedFetch =
  (files: Readonly<Record<string, HostedFile>>, served: Map<string, number>): typeof fetch =>
  async (input, init) => {
    const req = new Request(input, init)
    const file = files[req.url]
    if (!file) return new Response('not found', { status: 404 })
    if (file.status) return new Response('', { status: file.status })
    // Stream in 16 KiB chunks and count every chunk handed out: a reader that
    // stops early (the header validator) is observable as bytes not served.
    const stream = (bytes: Uint8Array) => {
      let offset = 0 // per response; `served` totals across responses for the same URL
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= bytes.length) return controller.close()
          const chunk = bytes.slice(offset, offset + 16 * 1024)
          offset += chunk.length
          served.set(req.url, (served.get(req.url) ?? 0) + chunk.length)
          controller.enqueue(chunk)
        },
      })
    }
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.get('range') ?? '')
    if (range && !file.ignoreRange) {
      const start = Number(range[1])
      const end = Math.min(Number(range[2]), file.bytes.length - 1)
      return new Response(stream(file.bytes.slice(start, end + 1)), {
        status: 206,
        headers: {
          'content-type': file.contentType,
          'content-range': `bytes ${start}-${end}/${file.bytes.length}`,
          'content-length': String(end - start + 1),
        },
      })
    }
    return new Response(stream(file.bytes), {
      status: 200,
      headers: { 'content-type': file.contentType, 'content-length': String(file.bytes.length) },
    })
  }
