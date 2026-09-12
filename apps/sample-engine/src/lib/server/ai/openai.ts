import type { AiAdapter } from './adapter.js'

/** OpenAI Images (`gpt-image-1`), portrait 1024×1536 so it fits the poster and tee aspects. */
export const openAiAdapter = (apiKey: string, fetchImpl: typeof fetch = fetch): AiAdapter => ({
  name: 'openai',
  generate: async (prompt) => {
    const res = await fetchImpl('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1024x1536', n: 1 }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!res.ok) throw new Error(`OpenAI answered ${res.status}`)
    const body = (await res.json()) as { data?: { b64_json?: string }[] }
    const b64 = body.data?.[0]?.b64_json
    if (!b64) throw new Error('OpenAI returned no image')
    return { bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), contentType: 'image/png' }
  },
})
