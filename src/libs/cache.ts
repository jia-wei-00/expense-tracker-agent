/**
 * Thin read-through helpers over a Cloudflare KV namespace.
 *
 * KV is eventually consistent, so it is only used for data that tolerates a
 * short staleness window (e.g. the user's category list). Anything that must
 * reflect the latest write (pending approvals, expense balances) stays in
 * Supabase.
 */

/**
 * Builds a namespaced cache key. Keys must always include the owning user id
 * because KV bypasses Supabase RLS.
 */
export function cacheKey(...parts: (string | number)[]) {
  return parts.join(":");
}

/**
 * Returns the cached JSON value for `key`, otherwise runs `loader` and stores
 * its result for `ttl` seconds.
 *
 * KV failures are swallowed so a cache outage degrades to a direct load instead
 * of failing the request.
 */
export async function getOrSet<T>(
  kv: KVNamespace | undefined,
  key: string,
  ttl: number,
  loader: () => Promise<T>,
): Promise<T> {
  if (!kv) return loader();

  try {
    const cached = await kv.get<T>(key, "json");
    if (cached !== null) return cached;
  } catch {
    return loader();
  }

  const value = await loader();

  try {
    await kv.put(key, JSON.stringify(value), { expirationTtl: ttl });
  } catch {
    // Ignore write failures; the value is still returned to the caller.
  }

  return value;
}

/** Best-effort invalidation; never throws. */
export async function invalidate(
  kv: KVNamespace | undefined,
  key: string,
): Promise<void> {
  if (!kv) return;

  try {
    await kv.delete(key);
  } catch {
    // Ignore; the entry will expire via TTL.
  }
}
