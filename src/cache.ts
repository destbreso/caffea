import { Node, IntrusiveList } from "./lru";

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

/**
 * A fixed-capacity in-memory cache laid out as W-TinyLFU's storage: a small LRU
 * admission `window` in front of a Segmented LRU `main` region (a `probation`
 * segment and a larger `protected` one). New keys enter the window; the entry
 * that ages out of the window becomes a candidate for the main region; a hit in
 * probation promotes an entry into protected, where the genuinely reused items
 * accumulate.
 *
 * This is the storage layer. The frequency-based ADMISSION decision (should the
 * window's candidate displace the main region's victim?) is deliberately a
 * single overridable seam, `shouldAdmit`, which for now always admits. Wiring it
 * to the frequency sketch, the step that turns this into true W-TinyLFU and lets
 * it resist scan pollution, is the next phase.
 */
export class Cache<K, V> {
  private readonly map = new Map<K, Node<K, V>>();
  private readonly window = new IntrusiveList<K, V>();
  private readonly probation = new IntrusiveList<K, V>();
  private readonly protectedSeg = new IntrusiveList<K, V>();

  private readonly windowMax: number;
  private readonly protectedMax: number;
  readonly capacity: number;

  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;

  constructor(capacity: number) {
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
  }

  get size(): number {
    return this.map.size;
  }

  /** Read a key, recording it as a use (which may promote it). */
  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (node === undefined) {
      this._misses++;
      return undefined;
    }
    this._hits++;
    this.onAccess(node);
    return node.value;
  }

  /** Insert or update a key. */
  set(key: K, value: V): void {
    const existing = this.map.get(key);
    if (existing !== undefined) {
      existing.value = value;
      this.onAccess(existing);
      return;
    }
    const node = new Node(key, value);
    node.segment = WINDOW;
    this.map.set(key, node);
    this.window.pushHead(node);
    this.evict();
  }

  /** Read without recording a use: no promotion, no hit/miss accounting. */
  peek(key: K): V | undefined {
    return this.map.get(key)?.value;
  }

  has(key: K): boolean {
    return this.map.has(key);
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
      // No distinct entry to weigh it against: the candidate cannot be held.
      this.unlink(candidate);
      this._evictions++;
      return;
    }

    const loser = this.shouldAdmit(candidate, victim) ? victim : candidate;
    this.unlink(loser);
    this._evictions++;
  }

  /**
   * Should `candidate` (aged out of the window) be admitted into the main region
   * at the cost of `victim` (the coldest main entry)? For now, always yes. The
   * next phase overrides this with a frequency comparison, so that a one-hit
   * scan key cannot evict a proven-hot entry.
   */
  private shouldAdmit(_candidate: Node<K, V>, _victim: Node<K, V>): boolean {
    return true;
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
