/**
 * A small PNG writer: 8-bit RGB or RGBA, filter 0, zlib via CompressionStream
 * (available on Node 18+, Workers and browsers). Writes sRGB + gAMA so the
 * file declares its colour space, and pHYs for the Spec's DPI.
 */
const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};

const deflate = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

export interface PngImage {
  readonly width: number;
  readonly height: number;
  /** RGBA (4 channels) or RGB (3); `channels` says which. */
  readonly data: Uint8ClampedArray | Uint8Array;
  readonly channels: 3 | 4;
  readonly dpi: number;
}

export const encodePng = async (img: PngImage): Promise<Uint8Array> => {
  const { width, height, channels } = img;
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 4 ? 6 : 2; // colour type: RGBA or RGB
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ppm = Math.round(img.dpi / 0.0254);
  const phys = new Uint8Array(9);
  const pv = new DataView(phys.buffer);
  pv.setUint32(0, ppm);
  pv.setUint32(4, ppm);
  phys[8] = 1; // unit: metre
  const gama = new Uint8Array(4);
  new DataView(gama.buffer).setUint32(0, 45455);
  const parts = [
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('sRGB', new Uint8Array([0])), // perceptual
    chunk('gAMA', gama),
    chunk('pHYs', phys),
    chunk('IDAT', await deflate(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
