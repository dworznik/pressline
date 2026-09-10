/** Constant-time string comparison for tokens and signatures (no early exit on the first differing byte). */
export const timingSafeEqual = (a: string, b: string): boolean => {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
};
