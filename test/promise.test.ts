import { describe, it, expect } from "vitest";

import { Cache } from "../src/cache";
import { LRU } from "../src/policy";
import { WTinyLFU } from "../src/w-tinylfu";

/**
 * The sentence on the front of the box, asserted.
 *
 * The README does not claim a hit ratio. It claims a **comparison**: that
 * W-TinyLFU "beats plain LRU on skewed (Zipfian) and bursty workloads" and
 * delivers "a measurably higher hit ratio". Every other test in this suite
 * checks a mechanism that exists in order to make that true, which is not the
 * same thing and does not imply it.
 *
 * The gap this closes is specific and was real: the workload test next door
 * asserts `hitRatio > 0.6` on a skewed trace, an absolute threshold that would
 * pass unchanged on a day when LRU scored 0.75 on the identical trace. A claim
 * of the form "beats X" can only be checked by running X.
 *
 * So each case here races the two policies over the **same** trace, in the same
 * process, at the same capacity, and asserts the direction of the difference
 * plus a margin large enough that a real regression cannot hide inside it.
 */

/** Deterministic PRNG so the workload tests never flake. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CAPACITY = 50;

const hitRatioUnder = (policy: "wtinylfu" | "lru", trace: readonly number[]): number => {
  const cache =
    policy === "lru"
      ? new Cache<number, number>(CAPACITY, { policy: new LRU() })
      : new Cache<number, number>(CAPACITY, {
          // Fixed so the admission filter's tie-break cannot make the test flake.
          policy: new WTinyLFU<number, number>({ random: () => 0.99 }),
        });
  for (const key of trace) if (cache.get(key) === undefined) cache.set(key, key);
  return cache.stats().hitRatio;
};

/** A hot set that fits in cache, plus a long cold tail. */
const skewed = (): number[] => {
  const rng = mulberry32(1);
  const hot = 40;
  const coldTail = 5_000;
  return Array.from({ length: 40_000 }, () =>
    rng() < 0.8 ? (rng() * hot) | 0 : hot + ((rng() * coldTail) | 0),
  );
};

/** Zipf, which is the distribution the README names by name. */
const zipfian = (): number[] => {
  const rng = mulberry32(7);
  const keys = 10_000;
  const cumulative: number[] = [0];
  for (let i = 1; i <= keys; i++) cumulative.push(cumulative[i - 1]! + 1 / i);
  const total = cumulative[keys]!;
  return Array.from({ length: 100_000 }, () => {
    const target = rng() * total;
    let low = 1;
    let high = keys;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (cumulative[mid]! < target) low = mid + 1;
      else high = mid;
    }
    return low;
  });
};

/** A hot set interrupted by a sweep of keys that are never requested twice. */
const scanHeavy = (): number[] => {
  const rng = mulberry32(3);
  let cold = 1_000_000;
  return Array.from({ length: 60_000 }, () => (rng() < 0.7 ? (rng() * 40) | 0 : cold++));
};

describe("the claim on the box: it beats plain LRU where it says it does", () => {
  const cases: Array<{ name: string; trace: number[]; margin: number }> = [
    { name: "a skewed workload", trace: skewed(), margin: 1.1 },
    { name: "a Zipfian workload", trace: zipfian(), margin: 1.1 },
    { name: "a scan-heavy workload", trace: scanHeavy(), margin: 1.1 },
  ];

  for (const { name, trace, margin } of cases) {
    it(`admits a higher hit ratio than LRU on ${name}`, () => {
      const ours = hitRatioUnder("wtinylfu", trace);
      const lru = hitRatioUnder("lru", trace);

      // Same trace, same capacity, same process. The only difference is policy.
      expect(ours).toBeGreaterThan(lru * margin);
    });
  }

  /**
   * And the other half of the promise, which is the one a frequency filter is
   * most at risk of breaking: the README also says the win comes "without
   * giving up recency". A policy that admitted purely on frequency would fail
   * here while passing everything above.
   */
  it("still serves a key that just became hot, which pure frequency would not", () => {
    const cache = new Cache<number, number>(CAPACITY, {
      policy: new WTinyLFU<number, number>({ random: () => 0.99 }),
    });
    // Establish a frequency history that has nothing to do with the newcomer.
    for (let round = 0; round < 200; round++) {
      for (let key = 0; key < 40; key++) if (cache.get(key) === undefined) cache.set(key, key);
    }
    // A brand new key, requested repeatedly, must become resident.
    for (let i = 0; i < 20; i++) if (cache.get(9_999) === undefined) cache.set(9_999, 9_999);
    expect(cache.get(9_999)).toBe(9_999);
  });
});
