import { describe, it, expect } from "vitest";
import { FrequencySketch } from "../src/frequency-sketch";

/** Deterministic 32-bit PRNG (mulberry32) so statistical tests never flake. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// arbitrary but fixed key hashes
const A = 0x12345678 | 0;
const B = 0x0badf00d | 0;

describe("FrequencySketch (CountMin4 + aging)", () => {
  it("counts an isolated key exactly, then saturates at 15", () => {
    const s = new FrequencySketch(512);
    expect(s.frequency(A)).toBe(0);
    for (let i = 1; i <= 15; i++) {
      s.increment(A);
      expect(s.frequency(A)).toBe(i); // isolated key: MIN over 4 distinct rows == count
    }
    for (let i = 0; i < 50; i++) s.increment(A);
    expect(s.frequency(A)).toBe(15); // saturating: never exceeds 15
  });

  it("never underestimates the true count (the Count-Min guarantee)", () => {
    const s = new FrequencySketch(1024);
    const truth = new Map<number, number>();
    const rng = mulberry32(42);
    for (let i = 0; i < 5000; i++) {
      const key = (rng() * 2000) | 0;
      s.increment(key);
      truth.set(key, (truth.get(key) ?? 0) + 1);
    }
    for (const [key, count] of truth) {
      // estimate >= min(trueCount, 15), always (counters saturate at 15)
      expect(s.frequency(key)).toBeGreaterThanOrEqual(Math.min(count, 15));
    }
  });

  it("keeps a hot key strictly above a cold key", () => {
    const s = new FrequencySketch(512);
    for (let i = 0; i < 12; i++) s.increment(A);
    for (let i = 0; i < 3; i++) s.increment(B);
    expect(s.frequency(A)).toBeGreaterThan(s.frequency(B));
  });

  it("reset() halves every counter (recency aging)", () => {
    const s = new FrequencySketch(512);
    for (let i = 0; i < 15; i++) s.increment(A); // saturate A to 15
    for (let i = 0; i < 4; i++) s.increment(B); // B to 4

    s.reset();
    expect(s.frequency(A)).toBe(7); // 15 >> 1
    expect(s.frequency(B)).toBe(2); // 4 >> 1

    s.reset();
    expect(s.frequency(A)).toBe(3); // 7 >> 1
    expect(s.frequency(B)).toBe(1); // 2 >> 1
  });

  it("ages automatically once sampleSize increments accumulate", () => {
    const s = new FrequencySketch(10);
    expect(s.sampleSize).toBe(100);

    for (let i = 0; i < 15; i++) s.increment(A); // A saturated at 15
    // push well past sampleSize with distinct filler keys => at least one reset
    for (let k = 0; k < s.sampleSize + 20; k++) s.increment(2000 + k);

    expect(s.frequency(A)).toBeLessThan(15); // hot key decayed by the aging
  });

  it("clear() wipes all state", () => {
    const s = new FrequencySketch(256);
    for (let i = 0; i < 10; i++) s.increment(A);
    s.clear();
    expect(s.frequency(A)).toBe(0);
    expect(s.size).toBe(0);
  });

  it("rejects invalid capacities", () => {
    expect(() => new FrequencySketch(0)).toThrow(RangeError);
    expect(() => new FrequencySketch(-5)).toThrow(RangeError);
    expect(() => new FrequencySketch(2.5)).toThrow(RangeError);
  });
});
