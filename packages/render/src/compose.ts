import type { Rgb, Rgba, RenderOptions } from './types.js'

export interface Layout {
  /** Scaled source size. */
  readonly width: number
  readonly height: number
  /** Where the scaled source's top-left lands on the canvas (negative when covering). */
  readonly x: number
  readonly y: number
}

const factor = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 } as const

/** Fit a `srcW`×`srcH` image into a `W`×`H` canvas. */
export const layout = (
  srcW: number,
  srcH: number,
  W: number,
  H: number,
  fit: NonNullable<RenderOptions['fit']>,
  align: NonNullable<RenderOptions['align']>,
): Layout => {
  const scale = fit === 'cover' ? Math.max(W / srcW, H / srcH) : Math.min(W / srcW, H / srcH)
  const width = Math.max(1, Math.round(srcW * scale))
  const height = Math.max(1, Math.round(srcH * scale))
  const ax = factor[align.x ?? 'center']
  const ay = factor[align.y ?? 'center']
  return { width, height, x: Math.round((W - width) * ax), y: Math.round((H - height) * ay) }
}

export interface Canvas {
  readonly width: number
  readonly height: number
  readonly channels: 3 | 4
  readonly data: Uint8ClampedArray
}

/**
 * Paint the scaled source onto a canvas. With a background the result is
 * opaque (source-over compositing, 3 channels); with `transparent` the alpha
 * is kept (4 channels).
 */
export const compose = (
  src: Rgba,
  W: number,
  H: number,
  at: Layout,
  background: Rgb | 'transparent',
): Canvas => {
  const opaque = background !== 'transparent'
  const channels = opaque ? 3 : 4
  const data = new Uint8ClampedArray(W * H * channels)
  if (opaque) {
    for (let i = 0; i < W * H; i++) {
      data[i * 3] = background.r
      data[i * 3 + 1] = background.g
      data[i * 3 + 2] = background.b
    }
  }
  const x0 = Math.max(0, at.x)
  const y0 = Math.max(0, at.y)
  const x1 = Math.min(W, at.x + src.width)
  const y1 = Math.min(H, at.y + src.height)
  for (let y = y0; y < y1; y++) {
    const sy = y - at.y
    for (let x = x0; x < x1; x++) {
      const sx = x - at.x
      const s = (sy * src.width + sx) * 4
      const d = (y * W + x) * channels
      if (opaque) {
        const a = src.data[s + 3]! / 255
        data[d] = src.data[s]! * a + data[d]! * (1 - a)
        data[d + 1] = src.data[s + 1]! * a + data[d + 1]! * (1 - a)
        data[d + 2] = src.data[s + 2]! * a + data[d + 2]! * (1 - a)
      } else {
        data[d] = src.data[s]!
        data[d + 1] = src.data[s + 1]!
        data[d + 2] = src.data[s + 2]!
        data[d + 3] = src.data[s + 3]!
      }
    }
  }
  return { width: W, height: H, channels, data }
}
