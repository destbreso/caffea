// Hit-ratio bake-off: W-TinyLFU vs LRU vs LFU, ALL three the library's own
// eviction policies, driven through one Cache and swapped by a single line.
//
// This is the cache's real benchmark, the one the sketch bench could not run:
// it drives all three policies through the SAME traces and reports hit ratio.
// The point of caffea is eviction *quality*, and quality only shows up as a hit
// ratio on a workload, so that is what we measure here.
//
// Honesty notes:
//   - The baselines are not strawmen and not separate throwaway code: they are
//     `new LRU()` and `new LFU()`, the same shipped policies you can install.
//     LRU is the intrusive-list LRU; LFU is the canonical O(1) frequency-bucket
//     LFU with an LRU tie-break, in-cache counts only (no aging) which is the
//     realistic kind and the weakness W-TinyLFU's sketch is built to fix.
//   - Every policy sees one recorded access per request: a `has`-gated driver
//     does `get` on a hit and `set` on a miss, never both, so no key is
//     double-counted. Hits are tallied by the driver, not read from any cache's
//     internal stats, so the three are scored identically.
//   - Everything is seeded (traces and W-TinyLFU's admission coin-flip), so the
//     numbers are reproducible run to run.
//
// Run with: npm run bench:cache  (builds first, then executes this file).

import { Cache, WTinyLFU, LRU, LFU } from "../dist/index.js";

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

// --- The three contenders: one Cache, three policies -----------------------

const lru = (cap) => new Cache(cap, { policy: new LRU() });
const lfu = (cap) => new Cache(cap, { policy: new LFU() });
// A seeded coin per size so W-TinyLFU's tie-break is reproducible.
const wtl = (cap) =>
  new Cache(cap, { policy: new WTinyLFU({ random: mulberry32(0x9e3779b9 ^ cap) }) });

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

function run(label, trace, cap) {
  const a = hitRatio(lru(cap), trace);
  const b = hitRatio(lfu(cap), trace);
  const c = hitRatio(wtl(cap), trace);
  const pct = (x) => (100 * x).toFixed(2) + "%";
  const pts = (x) => (x >= 0 ? "+" : "") + (100 * x).toFixed(2) + " pts";
  console.log(`\n== ${label} ==`);
  console.log(`  LRU          ${pct(a)}`);
  console.log(`  LFU          ${pct(b)}`);
  console.log(`  caffea       ${pct(c)}   (${pts(c - a)} vs LRU, ${pts(c - b)} vs LFU)`);
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
  const a = hitRatio(lru(cap), zipf);
  const b = hitRatio(lfu(cap), zipf);
  const c = hitRatio(wtl(cap), zipf);
  const p = (x) => (100 * x).toFixed(2) + "%";
  console.log(
    `  ${String(cap).padStart(5)}   ${p(a).padStart(7)}   ${p(b).padStart(7)}   ${p(c).padStart(7)}`,
  );
}
