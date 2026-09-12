/** Pixel size from a PNG or JPEG header, so the byte budget can be checked before decoding. */
export const rasterSize = (bytes: Uint8Array): { width: number; height: number } | undefined => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) {
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 <= bytes.length) {
      if (bytes[offset] !== 0xff) return undefined
      const marker = bytes[offset + 1]!
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        offset += 2
        continue
      }
      const length = view.getUint16(offset + 2)
      const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
      if (isSof) return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) }
      offset += 2 + length
    }
  }
  return undefined
}

/** Declared size of an SVG from `width`/`height` (px) or `viewBox`; undefined when it has none. */
export const svgSize = (svg: string): { width: number; height: number } | undefined => {
  const open = /<svg\b[^>]*>/i.exec(svg)?.[0]
  if (!open) return undefined
  const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(open)?.[1]
  const px = (v: string | undefined) => {
    if (!v) return undefined
    const n = Number.parseFloat(v)
    return Number.isFinite(n) && n > 0 && /^[\d.]+(px)?$/.test(v.trim()) ? n : undefined
  }
  const w = px(attr('width'))
  const h = px(attr('height'))
  if (w && h) return { width: w, height: h }
  const vb = attr('viewBox')
    ?.split(/[\s,]+/)
    .map(Number)
  if (vb && vb.length === 4 && vb[2]! > 0 && vb[3]! > 0) return { width: vb[2]!, height: vb[3]! }
  return undefined
}
