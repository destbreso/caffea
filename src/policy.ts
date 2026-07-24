import { Node, IntrusiveList } from "./list";

/**
 * An eviction policy decides how entries are ordered and who is evicted when the
 * cache is full. The `Cache` owns membership, statistics, and TTL; it delegates
 * every ordering decision to the policy through these hooks. Implement this to
 * plug in your own strategy; `WTinyLFU` (the default), `LRU`, and `LFU` are the
 * built-in implementations.
 *
 * The policy owns its own data structures and may use the scratch fields on
 * `Node` (`segment`, `hash`, `freq`) however it likes. It must NOT touch `key`,
 * `value`, or `expiresAt`, which belong to the cache.
 */
export interface EvictionPolicy<K, V> {
  /**
   * Called once, before any other hook, with the cache's capacity. Size any
   * capacity-dependent structures here (a window, a sketch) rather than in the
   * constructor, so a policy instance can be created without knowing capacity.
   */
  init(capacity: number): void;

  /**
   * A brand-new entry has just been inserted into the cache. Link it into the
   * policy's structures. If admitting it pushed the policy past capacity, return
   * the entry to EVICT (the cache removes it from the map and counts it); this
   * may be `node` itself, which is how an admission filter rejects a weak
   * newcomer. Return `null` if nothing needs to be evicted.
   */
  onAdd(node: Node<K, V>): Node<K, V> | null;

  /** A resident entry was read or overwritten (a hit). Record the use. */
  onAccess(node: Node<K, V>): void;

  /**
   * A lookup missed: `key` is not resident. A frequency-based policy can record
   * the demand so a hot-but-uncached key can build up standing. Most policies
   * do nothing here.
   */
  onMiss(key: K): void;

  /** An entry is leaving by explicit `delete` (not eviction). Unlink it. */
  onRemove(node: Node<K, V>): void;

  /** Drop all internal state (for `cache.clear()`). */
  clear(): void;
}

/**
 * Least Recently Used: one intrusive list, most-recently-used at the head. A hit
 * moves the entry to the head; the entry to evict is always the tail. The right
 * default for uniform traffic, and the baseline W-TinyLFU improves on for skewed
 * and scan-heavy traffic.
 */
export class LRU<K, V> implements EvictionPolicy<K, V> {
  private readonly list = new IntrusiveList<K, V>();
  private capacity = 0;

  init(capacity: number): void {
    this.capacity = capacity;
  }

  onAdd(node: Node<K, V>): Node<K, V> | null {
    this.list.pushHead(node);
    if (this.list.size > this.capacity) return this.list.popTail();
    return null;
  }

  onAccess(node: Node<K, V>): void {
    this.list.moveToHead(node);
  }

  onMiss(): void {
    /* recency has no use for a missed key */
  }

  onRemove(node: Node<K, V>): void {
    this.list.remove(node);
  }

  clear(): void {
    this.list.clear();
  }
}

/**
 * Least Frequently Used (in-cache counts, LRU tie-break): a list per frequency
 * level, so the entry to evict is the least-recently-used entry in the lowest
 * non-empty level. A hit moves the entry up one level. This is the classic O(1)
 * LFU; it has no aging, so a once-hot key can linger, which is exactly the
 * weakness W-TinyLFU's aging sketch fixes. Offered for comparison and for the
 * workloads where plain frequency is the right call.
 */
export class LFU<K, V> implements EvictionPolicy<K, V> {
  private readonly buckets = new Map<number, IntrusiveList<K, V>>();
  private capacity = 0;
  private minFreq = 0;
  private size = 0;

  init(capacity: number): void {
    this.capacity = capacity;
  }

  private bucket(freq: number): IntrusiveList<K, V> {
    let b = this.buckets.get(freq);
    if (b === undefined) {
      b = new IntrusiveList<K, V>();
      this.buckets.set(freq, b);
    }
    return b;
  }

  onAdd(node: Node<K, V>): Node<K, V> | null {
    // Evict before inserting, so a fresh entry is always admitted (the standard
    // LFU contract), displacing the least-recently-used of the coldest level.
    let victim: Node<K, V> | null = null;
    if (this.size >= this.capacity) {
      const b = this.buckets.get(this.minFreq);
      if (b !== undefined) {
        victim = b.popTail();
        if (b.size === 0) this.buckets.delete(this.minFreq);
        this.size--;
      }
    }
    node.freq = 1;
    this.bucket(1).pushHead(node);
    this.minFreq = 1;
    this.size++;
    return victim;
  }

  onAccess(node: Node<K, V>): void {
    const f = node.freq;
    const b = this.buckets.get(f);
    if (b !== undefined) {
      b.remove(node);
      if (b.size === 0) {
        this.buckets.delete(f);
        if (this.minFreq === f) this.minFreq = f + 1;
      }
    }
    node.freq = f + 1;
    this.bucket(f + 1).pushHead(node);
  }

  onMiss(): void {
    /* an out-of-cache key has no counter to raise */
  }

  onRemove(node: Node<K, V>): void {
    const f = node.freq;
    const b = this.buckets.get(f);
    if (b === undefined) return;
    b.remove(node);
    this.size--;
    if (b.size === 0) {
      this.buckets.delete(f);
      if (this.minFreq === f) this.recomputeMin();
    }
  }

  clear(): void {
    this.buckets.clear();
    this.minFreq = 0;
    this.size = 0;
  }

  /** Find the lowest non-empty level again after a delete emptied the old min. */
  private recomputeMin(): void {
    let m = Infinity;
    for (const f of this.buckets.keys()) if (f < m) m = f;
    this.minFreq = m === Infinity ? 0 : m;
  }
}
