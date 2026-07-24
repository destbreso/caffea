import { Node } from "./list";
import type { EvictionPolicy } from "./policy";
import { WTinyLFU } from "./w-tinylfu";
import { createPolicy } from "./registry";

/** Snapshot of runtime counters, returned by `cache.stats()`. */
export interface CacheStats {
  size: number;
  capacity: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRatio: number;
}

export interface CacheOptions<K, V> {
  /**
   * The eviction policy. Defaults to `new WTinyLFU()`. Pass a policy instance
   * (`new LRU()`, `new WTinyLFU({ hash, random })`, or your own `EvictionPolicy`),
   * or a registered name (`"w-tinylfu"`, `"lru"`, `"lfu"`, or any name you added
   * with `registerPolicy`). Key-specific tuning (the sketch hash, the admission
   * RNG) lives on `WTinyLFU`.
   */
  policy?: EvictionPolicy<K, V> | string;
  /**
   * Default time-to-live in milliseconds, applied to every entry (expire after
   * write). Omit for entries that never expire by default; a per-call `ttl` on
   * `set` overrides it. Must be a positive, finite number when given.
   */
  ttl?: number;
  /**
   * Current time in milliseconds. Defaults to `Date.now`. Inject a controllable
   * clock in tests so expiry is deterministic.
   */
  clock?: () => number;
}

/** Validate a TTL argument (constructor default or per-call), in ms. */
function checkTtl(ttl: number): number {
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new RangeError(
      `ttl must be a positive, finite number of milliseconds, got ${ttl}`,
    );
  }
  return ttl;
}

/**
 * A fixed-capacity cache. The cache owns membership, hit/miss/eviction
 * statistics, and TTL; every ordering and admission decision is delegated to an
 * `EvictionPolicy` (W-TinyLFU by default). Swap the policy to change eviction
 * behavior, or run the three built-ins against each other on your own traffic.
 *
 * TTL is orthogonal to the policy: expiry is checked lazily on every read path,
 * so a stale value is never served whatever policy is installed, and an expired
 * entry is unlinked the moment it is touched.
 */
export class Cache<K, V> {
  private readonly map = new Map<K, Node<K, V>>();
  private readonly policy: EvictionPolicy<K, V>;
  private readonly clock: () => number;
  private readonly defaultTtl: number | undefined;

  readonly capacity: number;

  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;

  constructor(capacity: number, options: CacheOptions<K, V> = {}) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(
        `Cache capacity must be a positive integer, got ${capacity}`,
      );
    }
    this.capacity = capacity;
    const requested = options.policy;
    this.policy =
      typeof requested === "string"
        ? createPolicy<K, V>(requested)
        : (requested ?? new WTinyLFU<K, V>());
    this.policy.init(capacity);
    this.clock = options.clock ?? Date.now;
    this.defaultTtl =
      options.ttl === undefined ? undefined : checkTtl(options.ttl);
  }

  get size(): number {
    return this.map.size;
  }

  /** Read a key, recording it as a use (which may promote it). */
  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (node === undefined) {
      this.policy.onMiss(key);
      this._misses++;
      return undefined;
    }
    if (this.isExpired(node)) {
      this.policy.onMiss(key); // the request still counts
      this.removeNode(node);
      this._misses++;
      return undefined;
    }
    this._hits++;
    this.policy.onAccess(node);
    return node.value;
  }

  /**
   * Insert or update a key. An optional `ttl` (milliseconds) overrides the
   * cache-wide default for this entry; writing a key always refreshes its expiry.
   */
  set(key: K, value: V, ttl?: number): void {
    const expiresAt = this.expiryFor(ttl);
    const existing = this.map.get(key);
    if (existing !== undefined) {
      existing.value = value;
      existing.expiresAt = expiresAt; // a write resets the TTL
      this.policy.onAccess(existing);
      return;
    }
    const node = new Node(key, value);
    node.expiresAt = expiresAt;
    this.map.set(key, node);
    const victim = this.policy.onAdd(node);
    if (victim !== null) {
      this.map.delete(victim.key);
      this._evictions++;
    }
  }

  /** Read without recording a use: no promotion, no hit/miss accounting. */
  peek(key: K): V | undefined {
    const node = this.map.get(key);
    if (node === undefined || this.isExpired(node)) return undefined;
    return node.value;
  }

  has(key: K): boolean {
    const node = this.map.get(key);
    if (node === undefined) return false;
    if (this.isExpired(node)) {
      this.removeNode(node);
      return false;
    }
    return true;
  }

  delete(key: K): boolean {
    const node = this.map.get(key);
    if (node === undefined) return false;
    this.removeNode(node);
    return true;
  }

  clear(): void {
    this.map.clear();
    this.policy.clear();
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
  }

  stats(): CacheStats {
    const total = this._hits + this._misses;
    return {
      size: this.map.size,
      capacity: this.capacity,
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
      hitRatio: total === 0 ? 0 : this._hits / total,
    };
  }

  // --- internals ---

  /** Unlink a node from the policy and drop it from the map. */
  private removeNode(node: Node<K, V>): void {
    this.policy.onRemove(node);
    this.map.delete(node.key);
  }

  /** Absolute expiry for a new/updated entry, given an optional per-call TTL. */
  private expiryFor(ttl: number | undefined): number {
    if (ttl !== undefined) return this.clock() + checkTtl(ttl);
    if (this.defaultTtl !== undefined) return this.clock() + this.defaultTtl;
    return Infinity;
  }

  /** True once the wall clock has reached the node's expiry (`Infinity` never). */
  private isExpired(node: Node<K, V>): boolean {
    return this.clock() >= node.expiresAt;
  }
}
