/**
 * An AI adapter turns a prompt into raster input for the same render path
 * as the template designer (ticket #22). Enabled when a key is present;
 * the sample never needs one.
 */
export interface AiAdapter {
  readonly name: string
  readonly generate: (
    prompt: string,
  ) => Promise<{ bytes: Uint8Array; contentType: 'image/png' | 'image/jpeg' }>
}
