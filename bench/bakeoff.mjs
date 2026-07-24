// Hit-ratio bake-off: caffea (W-TinyLFU) vs a plain LRU vs a plain LFU.
//
// This is the cache's real benchmark, the one the sketch bench could not run:
// it drives all three policies through the SAME traces and reports hit ratio.
// The point of caffea is eviction *quality*, and quality only shows up as a hit
// ratio on a workload, so that is what we measure here.
//
// Honesty notes:
//   - The two baselines are textbook-correct, not strawmen. LRU is the Map
//     insertion-order LRU; LFU is the canonical O(1) frequency-bucket LFU with an
//     LRU tie-break inside each bucket.
//   - LFU here is *in-cache* LFU (counts live only while a key is cached and are
//     lost on eviction). That is the realistic kind: keeping counts for evicted
//     keys needs unbounded memory, which is exactly the problem the frequency
//     sketch solves. caffea's whole trick is approximating perfect-LFU frequency
//     in a fixed-size sketch.
//   - Every policy sees one recorded access per request: a `has`-gated driver
//     does `get` on a hit and `set` on a miss, never both, so no key is
//     double-counted. Hits are tallied by the driver, not read from any policy's
//     internal stats, so the three are scored identically.
//   - Everything is seeded (traces and caffea's admission coin-flip), so numbers
//     are reproducible run to run.
//
// Run with: npm run bench:cache  (builds first, then executes this file).

import { Cache } from "../dist/index.js";

/** Deterministic 32-bit PRNG so runs are reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fmt = (n) => n.toLocaleString("en-US");

// --- Baselines -------------------------------------------------------------
// Textbook LRU and LFU, in the bench only (never shipped). Same surface as the
// caffea Cache the driver needs: has / get / set.

/** Classic LRU: a Map whose insertion order is the recency order. */
class LRU {
  constructor(capacity) {
    this.cap = capacity;
    this.map = new Map();
  }
  has(k) {
    return this.map.has(k);
  }
  get(k) {
    if (!this.map.has(k)) return undefined;
    const v = this.map.get(k);
    this.map.delete(k);
    this.map.set(k, v); // reinsert at the MRU end
    return v;
  }
  set(k, v) {
    if (this.map.has(k)) {
      this.map.delete(k);
    } else if (this.map.size >= this.cap) {
      this.map.delete(this.map.keys().next().value); // evict the LRU (oldest)
    }
    this.map.set(k, v);
  }
}

/**
 * Canonical O(1) LFU (Shah/Mitzenmacher-style frequency buckets). Each frequency
 * maps to an insertion-ordered Set of keys, so the first key in the minimum
 * bucket is the least-recently-used among the least-frequently-used: an LRU
 * tie-break, the standard strong LFU baseline. In-cache counts only, no aging.
 */
class LFU {
  constructor(capacity) {
    this.cap = capacity;
    this.val = new Map(); // key -> value
    this.freq = new Map(); // key -> frequency
    this.buckets = new Map(); // frequency -> Set<key> (insertion order = LRU)
    this.minFreq = 0;
  }
  has(k) {
    return this.val.has(k);
  }
  #bump(k) {
    const f = this.freq.get(k);
    const bucket = this.buckets.get(f);
    bucket.delete(k);
    if (bucket.size === 0) {
      this.buckets.delete(f);
      if (this.minFreq === f) this.minFreq++;
    }
    const nf = f + 1;
    this.freq.set(k, nf);
    if (!this.buckets.has(nf)) this.buckets.set(nf, new Set());
    this.buckets.get(nf).add(k);
  }
  get(k) {
    if (!this.val.has(k)) return undefined;
    this.#bump(k);
    return this.val.get(k);
  }
  set(k, v) {
    if (this.cap <= 0) return;
    if (this.val.has(k)) {
      this.val.set(k, v);
      this.#bump(k);
      return;
    }
    if (this.val.size >= this.cap) {
      const bucket = this.buckets.get(this.minFreq);
      const victim = bucket.values().next().value; // LRU of the min-freq bucket
      bucket.delete(victim);
      if (bucket.size === 0) this.buckets.delete(this.minFreq);
      this.val.delete(victim);
      this.freq.delete(victim);
    }
    this.val.set(k, v);
    this.freq.set(k, 1);
    if (!this.buckets.has(1)) this.buckets.set(1, new Set());
    this.buckets.get(1).add(k);
    this.minFreq = 1;
  }
}

// --- Driver ----------------------------------------------------------------

/** One recorded access per request: get on a hit, set on a miss. */
function hitRatio(cache, trace) {
  let hits = 0;
  for (let i = 0; i < trace.length; i++) {
    const k = trace[i];
    if (cache.has(k)) {
      cache.get(k);
      hits++;
    } else {
      cache.set(k, 1);
    }
  }
  return hits / trace.length;
}

/** Build a caffea Cache with a seeded coin so ties are reproducible. */
const caffea = (cap) => new Cache(cap, { random: mulberry32(0x9e3779b9 ^ cap) });

function run(label, trace, cap) {
  const lru = hitRatio(new LRU(cap), trace);
  const lfu = hitRatio(new LFU(cap), trace);
  const wtl = hitRatio(caffea(cap), trace);
  const pct = (x) => (100 * x).toFixed(2) + "%";
  const pts = (x) => (x >= 0 ? "+" : "") + (100 * x).toFixed(2) + " pts";
  console.log(`\n== ${label} ==`);
  console.log(`  LRU          ${pct(lru)}`);
  console.log(`  LFU          ${pct(lfu)}`);
  console.log(`  caffea       ${pct(wtl)}   (${pts(wtl - lru)} vs LRU, ${pts(wtl - lfu)} vs LFU)`);
  return { lru, lfu, wtl };
}

// --- Trace generators ------------------------------------------------------

/** Inverse-CDF Zipf sampler over keys [base, base+N) with weight 1/(i+1)^s. */
function zipfSampler(N, s, base, rng) {
  const cum = new Float64Array(N);
  let total = 0;
  for (let i = 0; i < N; i++) {
    total += 1 / Math.pow(i + 1, s);
    cum[i] = total;
  }
  return () => {
    const r = rng() * total;
    let lo = 0;
    let hi = N - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return base + lo;
  };
}

/** Pure Zipfian stream: the bread-and-butter skewed workload. */
function zipfTrace({ N, s, M, seed }) {
  const rng = mulberry32(seed);
  const sample = zipfSampler(N, s, 0, rng);
  const t = new Int32Array(M);
  for (let i = 0; i < M; i++) t[i] = sample();
  return t;
}

/**
 * Zipf hot stream punctuated by scans: every `period` requests, a run of
 * `scanLen` brand-new keys, each seen exactly once. This is scan pollution, the
 * pattern that flushes an LRU. Scan keys live above the hot key range.
 */
function scanTrace({ N, s, M, period, scanLen, seed }) {
  const rng = mulberry32(seed);
  const sample = zipfSampler(N, s, 0, rng);
  const out = [];
  let scanKey = 1_000_000; // disjoint from the hot range
  for (let i = 0; i < M; i++) {
    out.push(sample());
    if ((i + 1) % period === 0) {
      for (let j = 0; j < scanLen; j++) out.push(scanKey++);
    }
  }
  return Int32Array.from(out);
}

/**
 * A shifting working set: P phases, each Zipf-skewed over its OWN disjoint block
 * of keys. The popular set moves on every phase. This is where a no-aging LFU
 * gets stuck worshipping keys that went cold, and where recency (LRU) and aging
 * (caffea) earn their keep.
 */
function shiftTrace({ block, s, phaseLen, phases, seed }) {
  const rng = mulberry32(seed);
  const out = new Int32Array(phaseLen * phases);
  let w = 0;
  for (let p = 0; p < phases; p++) {
    const sample = zipfSampler(block, s, p * block, rng);
    for (let i = 0; i < phaseLen; i++) out[w++] = sample();
  }
  return out;
}

// --- Main ------------------------------------------------------------------

console.log("caffea :: hit-ratio bake-off  (W-TinyLFU vs LRU vs LFU)");

const zipf = zipfTrace({ N: 10_000, s: 0.9, M: 200_000, seed: 11 });
run("Zipfian  (s=0.90, N=10,000, cap=500, 200,000 reqs)", zipf, 500);

const scan = scanTrace({
  N: 10_000,
  s: 0.9,
  M: 200_000,
  period: 1_000,
  scanLen: 50,
  seed: 13,
});
run(
  `Scan pollution  (Zipf hot set + 50 fresh keys every 1,000 reqs, cap=500, ${fmt(scan.length)} reqs)`,
  scan,
  500,
);

const shift = shiftTrace({
  block: 5_000,
  s: 0.9,
  phaseLen: 50_000,
  phases: 4,
  seed: 17,
});
run(
  "Shifting working set  (4 phases, disjoint hot sets, cap=500, 200,000 reqs)",
  shift,
  500,
);

// A small capacity sweep on the Zipf trace: the hit-ratio-vs-size curve, the
// data behind the chart the series promised.
console.log("\n== Capacity sweep on the Zipfian trace (hit ratio) ==");
console.log("  cap      LRU       LFU       caffea");
for (const cap of [100, 250, 500, 1_000, 2_000]) {
  const lru = hitRatio(new LRU(cap), zipf);
  const lfu = hitRatio(new LFU(cap), zipf);
  const wtl = hitRatio(caffea(cap), zipf);
  const p = (x) => (100 * x).toFixed(2) + "%";
  console.log(
    `  ${String(cap).padStart(5)}   ${p(lru).padStart(7)}   ${p(lfu).padStart(7)}   ${p(wtl).padStart(7)}`,
  );
}
