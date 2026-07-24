import { Node, IntrusiveList } from "./list";
import { FrequencySketch } from "./frequency-sketch";
import type { EvictionPolicy } from "./policy";

// Segment tags stored in `node.segment`.
const WINDOW = 0;
const PROBATION = 1;
const PROTECTED = 2;

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

export interface WTinyLFUOptions<K> {
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
}

/**
 * The W-TinyLFU policy, and the cache's default. A small LRU admission `window`
 * (~1% of capacity) sits in front of a Segmented LRU main region (`probation`
 * and `protected`, the latter ~80% of main). A frequency sketch records every
 * access, and when the cache is full a candidate aged out of the window is
 * admitted only if the sketch says it has been seen at least as often as the
 * victim it would replace. That single comparison is what makes the cache resist
 * scan pollution: a key touched once cannot evict a proven-hot entry.
 *
 * See the `EvictionPolicy` interface for the hook contract.
 */
export class WTinyLFU<K, V> implements EvictionPolicy<K, V> {
  private readonly window = new IntrusiveList<K, V>();
  private readonly probation = new IntrusiveList<K, V>();
  private readonly protectedSeg = new IntrusiveList<K, V>();
  private readonly hasher: (key: K) => number;
  private readonly random: () => number;

  private sketch!: FrequencySketch;
  private capacity = 0;
  private windowMax = 0;
  private protectedMax = 0;

  constructor(options: WTinyLFUOptions<K> = {}) {
    this.hasher = options.hash ?? (defaultHash as (key: K) => number);
    this.random = options.random ?? Math.random;
  }

  init(capacity: number): void {
    this.capacity = capacity;
    // Caffeine's split: a ~1% recency window, the rest is the SLRU main region,
    // of which ~80% is the protected segment.
    this.windowMax = Math.max(1, Math.round(capacity * 0.01));
    const mainMax = capacity - this.windowMax;
    this.protectedMax = Math.round(mainMax * 0.8);
    this.sketch = new FrequencySketch(capacity);
  }

  onAdd(node: Node<K, V>): Node<K, V> | null {
    node.hash = this.hasher(node.key);
    this.sketch.increment(node.hash);
    node.segment = WINDOW;
    this.window.pushHead(node);
    return this.reconcile();
  }

  onAccess(node: Node<K, V>): void {
    this.sketch.increment(node.hash);
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

  onMiss(key: K): void {
    this.sketch.increment(this.hasher(key)); // requests count even on a miss
  }

  onRemove(node: Node<K, V>): void {
    this.detach(node);
  }

  clear(): void {
    this.window.clear();
    this.probation.clear();
    this.protectedSeg.clear();
    this.sketch.clear();
  }

  // --- internals ---

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

  /**
   * After an insertion, drain the window's LRU into probation as a candidate,
   * and if that put the cache over capacity, run the admission contest and
   * return the loser to evict (which may be the candidate itself).
   */
  private reconcile(): Node<K, V> | null {
    if (this.window.size <= this.windowMax) return null;

    // The window's LRU ages out and becomes the main region's candidate.
    const candidate = this.window.popTail();
    if (candidate === null) return null;
    candidate.segment = PROBATION;
    this.probation.pushHead(candidate);

    const total =
      this.window.size + this.probation.size + this.protectedSeg.size;
    if (total <= this.capacity) return null; // still room: keep the candidate

    // Full: the candidate competes with the coldest main entry.
    let victim = this.probation.tail;
    if (victim === null || victim === candidate) victim = this.protectedSeg.tail;
    if (victim === null || victim === candidate) {
      this.detach(candidate);
      return candidate;
    }

    const loser = this.shouldAdmit(candidate, victim) ? victim : candidate;
    this.detach(loser);
    return loser;
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

  /** Unlink a node from whichever segment holds it (the cache clears the map). */
  private detach(node: Node<K, V>): void {
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
  }
}
