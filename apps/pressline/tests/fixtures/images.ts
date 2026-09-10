/** Hand-built PNG/JPEG headers for header-only validation tests. No real image data needed. */

const crc32 = (bytes: Uint8Array) => {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
};

const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(
    [...type].map((c) => c.charCodeAt(0)),
    4,
  );
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};

export interface PngOptions {
  width: number;
  height: number;
  /** 0 grey, 2 rgb, 3 palette, 4 grey+alpha, 6 rgba */
  colourType?: 0 | 2 | 3 | 4 | 6;
  /** Add a tRNS chunk (transparency without an alpha channel). */
  trns?: boolean;
  /** Pad with junk so the file has this total size. */
  totalBytes?: number;
}

/** A structurally valid PNG prefix: signature, IHDR, optional tRNS, then padding "IDAT". */
export const png = ({ width, height, colourType = 6, trns = false, totalBytes }: PngOptions) => {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = colourType;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(trns ? [chunk('tRNS', new Uint8Array([0, 0]))] : []),
  ];
  const head = concat(parts);
  const size = Math.max(totalBytes ?? head.length + 12, head.length + 12);
  const idat = chunk('IDAT', new Uint8Array(size - head.length - 12));
  return concat([head, idat]);
};

/** A JPEG prefix: SOI, APP0, SOF0 with the given size, then padding. */
export const jpeg = ({
  width,
  height,
  totalBytes,
}: {
  width: number;
  height: number;
  totalBytes?: number;
}) => {
  const sof = new Uint8Array([
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ]);
  const app0 = new Uint8Array([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0,
  ]);
  const head = concat([new Uint8Array([0xff, 0xd8]), app0, sof]);
  const size = Math.max(totalBytes ?? head.length + 2, head.length + 2);
  const pad = new Uint8Array(size - head.length);
  pad[pad.length - 2] = 0xff;
  pad[pad.length - 1] = 0xd9;
  return concat([head, pad]);
};

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
