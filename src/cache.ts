import { Node, IntrusiveList } from "./lru";
import { FrequencySketch } from "./frequency-sketch";

// Segment tags stored on each node.
const WINDOW = 0;
const PROBATION = 1;
const PROTECTED = 2;

/** Snapshot of runtime counters, returned by `cache.stats()`. */
export interface CacheStats {
  size: number;
  capacity: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRatio: number;
}

export interface CacheOptions<K> {
  /**
   * Map a key to a 32-bit integer for the frequency sketch. The default handles
   * strings (FNV-1a) and integers (passed through; the sketch mixes them). Pass
   * your own for other key shapes.
   */
  hash?: (key: K) => number;
  /**
   * Source of randomness for the admission tie-break. Defaults to `Math.random`.
   * Inject a deterministic source in tests.
   */
  random?: () => number;
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

/** FNV-1a over the string form of a key; integers pass straight through. */
function defaultHash(key: unknown): number {
  if (typeof key === "number" && Number.isInteger(key)) return key | 0;
  const s = typeof key === "string" ? key : String(key);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
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
 * A fixed-capacity W-TinyLFU cache: a small LRU admission `window` in front of a
 * Segmented LRU `main` region (`probation` and `protected`), with a frequency
 * sketch gating who is allowed into the main region.
 *
 * Every access is recorded in the sketch, so the cache knows roughly how hot
 * each key is. When the cache is full and a candidate ages out of the window, it
 * is admitted only if the sketch says it has been seen at least as often as the
 * victim it would replace. That single rule is what makes the cache resist scan
 * pollution: a key touched once cannot evict a proven-hot entry.
 *
 * Entries may also carry a TTL (expire after write). Expiry is lazy: an expired
 * entry is treated as absent on the next access and unlinked then, and it is the
 * preferred (free) victim if the eviction policy meets it first.
 */
export class Cache<K, V> {
  private readonly map = new Map<K, Node<K, V>>();
  private readonly window = new IntrusiveList<K, V>();
  private readonly probation = new IntrusiveList<K, V>();
  private readonly protectedSeg = new IntrusiveList<K, V>();
  private readonly sketch: FrequencySketch;
  private readonly hasher: (key: K) => number;
  private readonly random: () => number;
  private readonly clock: () => number;
  private readonly defaultTtl: number | undefined;

  private readonly windowMax: number;
  private readonly protectedMax: number;
  readonly capacity: number;

  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;

  constructor(capacity: number, options: CacheOptions<K> = {}) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(
        `Cache capacity must be a positive integer, got ${capacity}`,
      );
    }
    this.capacity = capacity;
    // Caffeine's split: a ~1% recency window, the rest is the SLRU main region,
    // of which ~80% is the protected segment.
    this.windowMax = Math.max(1, Math.round(capacity * 0.01));
    const mainMax = capacity - this.windowMax;
    this.protectedMax = Math.round(mainMax * 0.8);
    this.sketch = new FrequencySketch(capacity);
    this.hasher = options.hash ?? (defaultHash as (key: K) => number);
    this.random = options.random ?? Math.random;
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
      this.sketch.increment(this.hasher(key)); // requests count even on a miss
      this._misses++;
      return undefined;
    }
    if (this.isExpired(node)) {
      this.sketch.increment(node.hash); // the request still counts
      this.unlink(node);
      this._misses++;
      return undefined;
    }
    this.sketch.increment(node.hash);
    this._hits++;
    this.onAccess(node);
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
      this.sketch.increment(existing.hash);
      existing.value = value;
      existing.expiresAt = expiresAt; // a write resets the TTL
      this.onAccess(existing);
      return;
    }
    const hash = this.hasher(key);
    this.sketch.increment(hash);
    const node = new Node(key, value);
    node.hash = hash;
    node.expiresAt = expiresAt;
    node.segment = WINDOW;
    this.map.set(key, node);
    this.window.pushHead(node);
    this.evict();
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
      this.unlink(node);
      return false;
    }
    return true;
  }

  delete(key: K): boolean {
    const node = this.map.get(key);
    if (node === undefined) return false;
    this.unlink(node);
    return true;
  }

  clear(): void {
    this.map.clear();
    this.window.clear();
    this.probation.clear();
    this.protectedSeg.clear();
    this.sketch.clear();
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

  private onAccess(node: Node<K, V>): void {
    switch (node.segment) {
      case WINDOW:
        this.window.moveToHead(node);
        break;
      case PROBATION:
        this.promote(node);
        break;
      default: // PROTECTED
        this.protectedSeg.moveToHead(node);
        break;
    }
  }

  /** A hit in probation graduates the entry to protected (demoting if full). */
  private promote(node: Node<K, V>): void {
    this.probation.remove(node);
    node.segment = PROTECTED;
    this.protectedSeg.pushHead(node);
    if (this.protectedSeg.size > this.protectedMax) {
      const demoted = this.protectedSeg.popTail();
      if (demoted !== null) {
        demoted.segment = PROBATION;
        this.probation.pushHead(demoted);
      }
    }
  }

  /** After an insertion, drain the window and, if over capacity, evict one. */
  private evict(): void {
    if (this.window.size <= this.windowMax) return;

    // The window's LRU ages out and becomes the main region's candidate.
    const candidate = this.window.popTail();
    if (candidate === null) return;
    candidate.segment = PROBATION;
    this.probation.pushHead(candidate);

    // Still room in the cache overall: keep the candidate, evict nothing.
    if (this.map.size <= this.capacity) return;

    // Full: the candidate competes with the coldest main entry.
    let victim = this.probation.tail;
    if (victim === null || victim === candidate) victim = this.protectedSeg.tail;
    if (victim === null || victim === candidate) {
      this.unlink(candidate);
      this._evictions++;
      return;
    }

    // A dead entry is the ideal victim: reclaim it without weighing frequency.
    // If the candidate itself has expired on its way through the window, drop it.
    if (this.isExpired(candidate)) {
      this.unlink(candidate);
      this._evictions++;
      return;
    }
    if (this.isExpired(victim)) {
      this.unlink(victim);
      this._evictions++;
      return;
    }

    const loser = this.shouldAdmit(candidate, victim) ? victim : candidate;
    this.unlink(loser);
    this._evictions++;
  }

  /**
   * The heart of W-TinyLFU. Admit `candidate` (aged out of the window) into the
   * main region at the cost of `victim` (the coldest main entry) only if the
   * sketch says the candidate is at least as frequently used. On a strict tie a
   * coin flip decides, so an incumbent is not permanently unbeatable and an
   * attacker cannot pin a key just under the victim. (Caffeine gates the random
   * admission on a warmup threshold; this is the simpler form.)
   */
  private shouldAdmit(candidate: Node<K, V>, victim: Node<K, V>): boolean {
    const candidateFreq = this.sketch.frequency(candidate.hash);
    const victimFreq = this.sketch.frequency(victim.hash);
    if (candidateFreq > victimFreq) return true;
    if (candidateFreq === victimFreq) return this.random() < 0.5;
    return false;
  }

  private unlink(node: Node<K, V>): void {
    switch (node.segment) {
      case WINDOW:
        this.window.remove(node);
        break;
      case PROBATION:
        this.probation.remove(node);
        break;
      default: // PROTECTED
        this.protectedSeg.remove(node);
        break;
    }
    this.map.delete(node.key);
  }
}
