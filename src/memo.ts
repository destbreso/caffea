import { Cache, type CacheStats } from "./cache";
import type { EvictionPolicy } from "./policy";

export interface MemoOptions<Args extends unknown[], R, K> {
  /** Maximum number of distinct cached calls. Default 1000. */
  capacity?: number;
  /**
   * Derive the cache key from the call arguments. Defaults to the first
   * argument, which is right for the common single-argument case
   * (`memo(fetchUser)` where `fetchUser(id)`); pass your own for multi-argument
   * functions (for example `(...args) => args.join(":")`).
   */
  keyFn?: (...args: Args) => K;
  /** Eviction policy for the underlying cache. Default `new WTinyLFU()`. */
  policy?: EvictionPolicy<K, R>;
  /** Default time-to-live in milliseconds for cached results. */
  ttl?: number;
  /** Clock for TTL, in milliseconds. Defaults to `Date.now`. */
  clock?: () => number;
}

/** A memoized function: callable like the original, plus cache controls. */
export interface Memoized<Args extends unknown[], R, K> {
  (...args: Args): R;
  /** The underlying cache: inspect it, read `.stats()`, etc. */
  readonly cache: Cache<K, R>;
  /** Invalidate one memoized call by its arguments. Returns whether it existed. */
  delete(...args: Args): boolean;
  /** Drop every memoized result. */
  clear(): void;
  /** Hit / miss / eviction counters for the memo cache. */
  stats(): CacheStats;
}

function isThenable(x: unknown): x is Promise<unknown> {
  return (
    x != null &&
    (typeof x === "object" || typeof x === "function") &&
    typeof (x as { then?: unknown }).then === "function"
  );
}

/**
 * Memoize a function, caching results in a koffein `Cache` (W-TinyLFU + optional
 * TTL by default). Works for sync and async functions.
 *
 * For async functions it caches the *promise*, so concurrent calls for the same
 * key share one in-flight computation (the underlying function runs once, not
 * once per caller), and it evicts the entry if that promise rejects, so a
 * failure is never cached and the next call retries. A result of `undefined` is
 * treated as "no result" and is not cached.
 */
export function memo<
  Args extends unknown[],
  R,
  K = Args extends [infer First, ...unknown[]] ? First : unknown,
>(
  fn: (...args: Args) => R,
  options: MemoOptions<Args, R, K> = {},
): Memoized<Args, R, K> {
  const cache = new Cache<K, R>(options.capacity ?? 1000, {
    policy: options.policy,
    ttl: options.ttl,
    clock: options.clock,
  });
  const keyFn =
    options.keyFn ?? ((...args: Args) => args[0] as unknown as K);

  const call = (...args: Args): R => {
    const key = keyFn(...args);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const result = fn(...args);
    cache.set(key, result);

    if (isThenable(result)) {
      result.then(undefined, () => {
        // Never cache a rejection: drop the entry so the next call retries.
        // Guard on identity so we only evict this promise, not a newer one.
        if (cache.peek(key) === result) cache.delete(key);
      });
    }
    return result;
  };

  return Object.assign(call, {
    cache,
    delete: (...args: Args): boolean => cache.delete(keyFn(...args)),
    clear: (): void => cache.clear(),
    stats: (): CacheStats => cache.stats(),
  }) as Memoized<Args, R, K>;
}
