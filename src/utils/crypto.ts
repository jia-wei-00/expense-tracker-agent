const encoder = new TextEncoder();

/**
 * Constant-time string comparison for secrets. `crypto.subtle.timingSafeEqual`
 * needs equal-length buffers, so a length mismatch compares `a` against itself
 * (same work, same timing) and returns false.
 */
export function timingSafeEqualText(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);

  if (left.byteLength !== right.byteLength) {
    crypto.subtle.timingSafeEqual(left, left);
    return false;
  }
  return crypto.subtle.timingSafeEqual(left, right);
}
