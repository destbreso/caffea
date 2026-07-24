// Benchmark for the frequency sketch (the piece that ships in 0.1.x).
//
// Two honest measurements:
//   1. Throughput: increment / frequency operations per second.
//   2. Accuracy:   the overestimate distribution over a Zipfian stream, plus a
//      scale check that Count-Min NEVER underestimates.
//
// The hit-ratio bake-off (W-TinyLFU vs LRU vs LFU on real traces) is the cache's
// benchmark and lands with the cache surface; it cannot be run on the sketch
// alone. Run with: npm run bench  (builds first, then executes this file).

import { FrequencySketch } from "../dist/index.js";

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

function throughput() {
  const OPS = 5_000_000;
  const sketch = new FrequencySketch(100_000);
  const rng = mulberry32(1);

  const keys = new Int32Array(OPS);
  for (let i = 0; i < OPS; i++) keys[i] = (rng() * 1e9) | 0;

  let t = performance.now();
  for (let i = 0; i < OPS; i++) sketch.increment(keys[i]);
  const incMs = performance.now() - t;

  let acc = 0;
  t = performance.now();
  for (let i = 0; i < OPS; i++) acc += sketch.frequency(keys[i]);
  const freqMs = performance.now() - t;

  const mops = (ms) => (OPS / ms / 1000).toFixed(1);
  console.log("\n== Throughput ==");
  console.log(`  increment  ${mops(incMs)} M ops/s  (${OPS / 1e6}M ops in ${incMs.toFixed(0)} ms)`);
  console.log(`  frequency  ${mops(freqMs)} M ops/s  (${OPS / 1e6}M ops in ${freqMs.toFixed(0)} ms)`);
  if (acc < 0) console.log(acc); // keep the JIT from eliding the loop
}

function accuracy() {
  const capacity = 50_000; // width = 65,536 counters/row
  const N = 200_000; // distinct keys (N > width => real collision pressure)
  const M = 400_000; // increments < sampleSize (500,000) => no aging, pure CM error
  const skew = 1.0;

  const sketch = new FrequencySketch(capacity);
  const truth = new Int32Array(N);

  // Zipf via inverse-CDF sampling over cumulative weights 1/(i+1)^skew.
  const cum = new Float64Array(N);
  let total = 0;
  for (let i = 0; i < N; i++) {
    total += 1 / Math.pow(i + 1, skew);
    cum[i] = total;
  }
  const rng = mulberry32(7);
  const sampleZipf = () => {
    const r = rng() * total;
    let lo = 0;
    let hi = N - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  for (let i = 0; i < M; i++) {
    const k = sampleZipf();
    sketch.increment(k);
    if (truth[k] < 15) truth[k]++; // ground truth, capped like the 4-bit counter
  }

  let observed = 0;
  let exact = 0;
  let off1 = 0;
  let off2 = 0;
  let maxErr = 0;
  let under = 0;
  for (let k = 0; k < N; k++) {
    if (truth[k] === 0) continue;
    observed++;
    const err = sketch.frequency(k) - truth[k];
    if (err < 0) under++;
    else if (err === 0) exact++;
    else if (err === 1) off1++;
    else off2++;
    if (err > maxErr) maxErr = err;
  }

  const pct = (n) => ((100 * n) / observed).toFixed(2) + "%";
  console.log("\n== Accuracy (Zipf s=1.0, 200k keys, 400k ops, 50k capacity) ==");
  console.log(`  distinct keys observed   ${fmt(observed)}`);
  console.log(`  exact estimate           ${pct(exact)}`);
  console.log(`  overestimate by 1        ${pct(off1)}`);
  console.log(`  overestimate by >= 2     ${pct(off2)}`);
  console.log(`  max overestimate         ${maxErr}`);
  console.log(`  underestimates           ${under}   (Count-Min guarantees 0)`);
}

console.log("caffea :: frequency sketch benchmark");
throughput();
accuracy();
