/**
 * Stale-while-revalidate cache backed by localStorage.
 *
 * - Stores timestamped JSON payloads under a prefixed key.
 * - `get()` returns the cached value if it exists (regardless of age).
 * - `isStale()` tells the caller whether a background refresh is needed.
 * - `set()` only writes when the new data is non-empty to avoid clobbering
 *   good cached data with an empty API response (R-2).
 */

const CACHE_PREFIX = 'simply_cache_';
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  ts: number; // unix ms when cached
}

/** Read a cached value. Returns `null` if nothing is stored. */
export function cacheGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    return entry.data;
  } catch {
    return null;
  }
}

/** Is the cached entry older than `ttlMs`? (Also true when there is no entry.) */
export function cacheIsStale(key: string, ttlMs = DEFAULT_TTL_MS): boolean {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return true;
    const entry: CacheEntry<unknown> = JSON.parse(raw);
    return Date.now() - entry.ts > ttlMs;
  } catch {
    return true;
  }
}

/**
 * Write to cache.
 * If `skipEmpty` is true (default), arrays with length 0 and nullish values
 * will NOT overwrite existing cached data.
 */
export function cacheSet<T>(key: string, data: T, skipEmpty = true): void {
  try {
    if (skipEmpty) {
      const isEmpty =
        data === null ||
        data === undefined ||
        (Array.isArray(data) && data.length === 0);
      if (isEmpty) {
        // Don't overwrite good cached data with empty response
        const existing = localStorage.getItem(CACHE_PREFIX + key);
        if (existing) return;
      }
    }
    const entry: CacheEntry<T> = { data, ts: Date.now() };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

/** Remove a cached key. */
export function cacheClear(key: string): void {
  try {
    localStorage.removeItem(CACHE_PREFIX + key);
  } catch {}
}
