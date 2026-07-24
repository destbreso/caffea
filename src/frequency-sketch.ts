/**
 * CountMin4: a Count-Min Sketch with 4-bit saturating counters and periodic
 * aging. This is the frequency estimator behind TinyLFU / W-TinyLFU admission.
 *
 * Why this shape:
 *  - Count-Min gives an approximate frequency in sublinear space. Its estimate
 *    is the MIN across `DEPTH` independent rows, so it can overestimate (on a
 *    hash collision) but NEVER underestimate. That one-sided error is exactly
 *    what an admission filter wants: we would rather admit a cold key than
 *    reject a hot one.
 *  - Counters are 4 bits (0..15). A cache does not need the true frequency, only
 *    "is this key hotter than the victim it would evict", so a saturating 4-bit
 *    counter is plenty and keeps the whole sketch tiny (eight counters per
 *    32-bit word).
 *  - Aging (`reset`) halves every counter once we have observed `sampleSize`
 *    increments. This is what makes TinyLFU recency-aware instead of a pure
 *    frequency count that a long-ago-popular key could dominate forever.
 *
 * The sketch operates on a pre-computed 32-bit `hash` of the key. Key hashing
 * lives in the cache layer so this stays a pure, independently testable
 * primitive (and reusable outside the cache).
 */

const DEPTH = 4; // hash rows; also the number of counters touched per key
const MAX_COUNT = 15; // 4-bit saturating ceiling
const COUNTERS_PER_WORD = 8; // eight 4-bit nibbles per Uint32 word
const ONE_PER_NIBBLE = 0x11111111; // low bit of every nibble
const RESET_MASK = 0x77777777; // clears each nibble's carry bit after `>>> 1`

/** Smallest power of two >= x (x >= 1). */
function ceilingPow2(x: number): number {
  if (x <= 1) return 1;
  return 1 << (32 - Math.clz32(x - 1));
}

/** Population count (Hamming weight) of a 32-bit word. */
function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

/** murmur3 fmix32 finalizer: mixes a 32-bit hash so low-entropy keys spread. */
function spread(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * A second, independent mix used as the stride in double hashing
 * (position_i = h1 + i * h2). Forced ODD so that, modulo a power-of-two width,
 * the DEPTH strides never coincide: the rows land on distinct counters.
 */
function rehash(h: number): number {
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) | 1) >>> 0;
}

export class FrequencySketch {
  private readonly table: Uint32Array;
  private readonly wordsPerRow: number;
  private readonly mask: number;
  private _size = 0;

  /** Nominal number of live entries the sketch is tuned for. */
  readonly capacity: number;
  /** Increment count that triggers an aging `reset` (10x capacity). */
  readonly sampleSize: number;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(
        `FrequencySketch capacity must be a positive integer, got ${capacity}`,
      );
    }
    const width = Math.max(ceilingPow2(capacity), COUNTERS_PER_WORD);
    this.capacity = capacity;
    this.wordsPerRow = width / COUNTERS_PER_WORD;
    this.mask = width - 1;
    this.table = new Uint32Array(DEPTH * this.wordsPerRow);
    const sample = 10 * capacity;
    // guard against overflow for absurd capacities
    this.sampleSize = sample > 0 && sample <= 0x7fffffff ? sample : 0x7fffffff;
  }

  /** Increments observed since the last aging reset (diagnostic / tests). */
  get size(): number {
    return this._size;
  }

  /**
   * Estimated frequency of `hash`, saturating at 15. One-sided error: the
   * returned value is >= the true count (never below it).
   */
  frequency(hash: number): number {
    const h1 = spread(hash);
    const h2 = rehash(h1);
    let min = MAX_COUNT;
    for (let i = 0; i < DEPTH; i++) {
      const j = (h1 + Math.imul(i, h2)) & this.mask;
      const word = this.table[i * this.wordsPerRow + (j >>> 3)]!;
      const nibble = (word >>> ((j & 7) << 2)) & 0xf;
      if (nibble < min) min = nibble;
    }
    return min;
  }

  /** Record one occurrence of `hash`; ages the sketch when the sample fills. */
  increment(hash: number): void {
    const h1 = spread(hash);
    const h2 = rehash(h1);
    let added = false;
    for (let i = 0; i < DEPTH; i++) {
      const j = (h1 + Math.imul(i, h2)) & this.mask;
      const idx = i * this.wordsPerRow + (j >>> 3);
      const shift = (j & 7) << 2;
      const word = this.table[idx]!;
      if (((word >>> shift) & 0xf) < MAX_COUNT) {
        this.table[idx] = (word + (1 << shift)) >>> 0;
        added = true;
      }
    }
    if (added && ++this._size >= this.sampleSize) {
      this.reset();
    }
  }

  /**
   * Halve every counter (recency-biased aging). Called automatically once
   * `sampleSize` increments accumulate; exposed for tests and manual decay.
   */
  reset(): void {
    let odd = 0;
    for (let i = 0; i < this.table.length; i++) {
      const w = this.table[i]!;
      odd += popcount32(w & ONE_PER_NIBBLE);
      this.table[i] = (w >>> 1) & RESET_MASK;
    }
    // Halve the running sample too, minus a correction for the low bits that
    // the shift discarded (odd counters lost an extra 0.5 each, spread over the
    // DEPTH rows). Affects only reset cadence, not the estimates themselves.
    this._size = (this._size - (odd >>> 2)) >>> 1;
  }

  /** Drop all state. */
  clear(): void {
    this.table.fill(0);
    this._size = 0;
  }
}
