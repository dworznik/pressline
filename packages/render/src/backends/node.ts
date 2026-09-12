import sharp from 'sharp'
import { RenderError, type Backend, type RenderInput } from '../types.js'

const source = (input: RenderInput) =>
  input.kind === 'raster' ? sharp(Buffer.from(input.bytes)) : sharp(Buffer.from(input.svg))

/** libvips via sharp: streams, so no byte budget; SVG rasterised at the requested size. */
export const nodeBackend: Backend = {
  name: 'node',
  size: async (input) => {
    const m = await source(input)
      .metadata()
      .catch((e: unknown) => {
        throw new RenderError('could not read the input', { cause: e })
      })
    if (!m.width || !m.height) throw new RenderError('input has no size')
    return { width: m.width, height: m.height }
  },
  rasterize: async (input, width, height) => {
    const { data, info } = await source(input)
      .resize(width, height, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
      .catch((e: unknown) => {
        throw new RenderError('could not decode or scale the input', { cause: e })
      })
    return {
      width: info.width,
      height: info.height,
      data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    }
  },
}
