/** Hand-built PNG/JPEG headers for header-only validation tests. No real image data needed; PNG lives with the e2e seed. */

export { png, type PngOptions } from '$lib/server/e2e/png';
import { concat } from '$lib/server/e2e/png';

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
