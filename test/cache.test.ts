import { describe, it, expect } from "vitest";
import { Cache } from "../src/cache";

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

describe("Cache (window + SLRU storage)", () => {
  it("stores and retrieves values", () => {
    const c = new Cache<string, number>(100);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.get("a")).toBe(1);
    expect(c.get("b")).toBe(2);
    expect(c.has("a")).toBe(true);
    expect(c.size).toBe(2);
  });

  it("returns undefined and counts a miss for unknown keys", () => {
    const c = new Cache<string, number>(10);
    expect(c.get("nope")).toBeUndefined();
    expect(c.stats().misses).toBe(1);
    expect(c.stats().hits).toBe(0);
  });

  it("updates the value of an existing key without growing", () => {
    const c = new Cache<string, number>(10);
    c.set("k", 1);
    c.set("k", 2);
    expect(c.get("k")).toBe(2);
    expect(c.size).toBe(1);
  });

  it("never exceeds capacity under a flood of inserts", () => {
    const cap = 64;
    const c = new Cache<number, number>(cap);
    for (let i = 0; i < cap * 20; i++) {
      c.set(i, i);
      expect(c.size).toBeLessThanOrEqual(cap);
    }
    expect(c.stats().evictions).toBeGreaterThan(0);
  });

  it("keeps a frequently accessed key alive through a scan of new keys", () => {
    const c = new Cache<string, string>(100);
    c.set("hot", "H");
    for (let i = 0; i < 1000; i++) {
      c.set(`cold-${i}`, "c"); // one-hit-wonders, never read again
      if (i % 2 === 0) c.get("hot"); // keep touching the hot key
    }
    expect(c.has("hot")).toBe(true);
    expect(c.get("hot")).toBe("H");
  });

  it("admits a frequently requested key over cold one-hit churn", () => {
    const c = new Cache<number, number>(20, { random: () => 0.99 });
    for (let i = 0; i < 100; i++) c.set(1000 + i, i); // prime with cold keys
    for (let round = 0; round < 60; round++) {
      if (c.get(7) === undefined) c.set(7, 7); // request key 7 every round
      c.set(2000 + round, round); // a fresh cold key competes for the slot
    }
    // key 7's frequency wins admission and keeps it resident through the churn
    expect(c.has(7)).toBe(true);
  });

  it("achieves a high hit ratio on a skewed workload", () => {
    const c = new Cache<number, number>(50, { random: () => 0.99 });
    const rng = mulberry32(1);
    const hot = 40; // the hot set fits within capacity
    const coldTail = 5000;
    for (let i = 0; i < 40000; i++) {
      const key =
        rng() < 0.8 ? (rng() * hot) | 0 : hot + ((rng() * coldTail) | 0);
      if (c.get(key) === undefined) c.set(key, key);
    }
    // a good policy parks the hot set and answers most requests from it
    expect(c.stats().hitRatio).toBeGreaterThan(0.6);
  });

  it("peek reads without recording a hit", () => {
    const c = new Cache<string, number>(10);
    c.set("a", 1);
    const before = c.stats().hits;
    expect(c.peek("a")).toBe(1);
    expect(c.peek("missing")).toBeUndefined();
    expect(c.stats().hits).toBe(before); // peek is not a use
  });

  it("delete removes a key", () => {
    const c = new Cache<string, number>(10);
    c.set("a", 1);
    expect(c.delete("a")).toBe(true);
    expect(c.delete("a")).toBe(false);
    expect(c.has("a")).toBe(false);
    expect(c.get("a")).toBeUndefined();
  });

  it("clear empties the cache and resets counters", () => {
    const c = new Cache<number, number>(10);
    for (let i = 0; i < 5; i++) c.set(i, i);
    c.get(0);
    c.clear();
    expect(c.size).toBe(0);
    const s = c.stats();
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(0);
    expect(s.evictions).toBe(0);
  });

  it("reports a sensible hit ratio", () => {
    const c = new Cache<string, number>(10);
    c.set("a", 1);
    c.get("a"); // hit
    c.get("a"); // hit
    c.get("x"); // miss
    const s = c.stats();
    expect(s.hits).toBe(2);
    expect(s.misses).toBe(1);
    expect(s.hitRatio).toBeCloseTo(2 / 3, 5);
  });

  it("stays correct and bounded at tiny capacities", () => {
    for (const cap of [1, 2, 3]) {
      const c = new Cache<number, number>(cap);
      for (let i = 0; i < 30; i++) {
        c.set(i, i);
        expect(c.size).toBeLessThanOrEqual(cap);
      }
      expect(c.has(29)).toBe(true); // the most-recently-inserted key is resident
    }
  });

  it("rejects invalid capacities", () => {
    expect(() => new Cache(0)).toThrow(RangeError);
    expect(() => new Cache(-1)).toThrow(RangeError);
    expect(() => new Cache(2.5)).toThrow(RangeError);
  });
});

describe("Cache TTL", () => {
  it("expires an entry after its per-call ttl", () => {
    let now = 0;
    const c = new Cache<string, number>(100, { clock: () => now });
    c.set("a", 1, 100); // lives 100ms
    now = 50;
    expect(c.get("a")).toBe(1); // still fresh
    now = 150;
    expect(c.get("a")).toBeUndefined(); // expired => a miss
    expect(c.stats().misses).toBe(1);
  });

  it("frees the slot when an expired entry is accessed", () => {
    let now = 0;
    const c = new Cache<string, number>(100, { clock: () => now });
    c.set("a", 1, 10);
    expect(c.size).toBe(1);
    now = 100;
    expect(c.get("a")).toBeUndefined();
    expect(c.size).toBe(0); // the dead entry was unlinked on access
  });

  it("applies the cache-wide default ttl to every entry", () => {
    let now = 0;
    const c = new Cache<string, number>(100, { clock: () => now, ttl: 30 });
    c.set("a", 1);
    c.set("b", 2);
    now = 20;
    expect(c.get("a")).toBe(1);
    now = 40;
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBeUndefined();
  });

  it("lets a per-call ttl override the default", () => {
    let now = 0;
    const c = new Cache<string, number>(100, { clock: () => now, ttl: 1000 });
    c.set("short", 1, 10); // overrides the 1000ms default downward
    now = 50;
    expect(c.get("short")).toBeUndefined(); // gone at 50ms
    c.set("long", 2); // uses the 1000ms default
    now = 500;
    expect(c.get("long")).toBe(2); // still alive
  });

  it("never expires an entry with no ttl and no default", () => {
    let now = 0;
    const c = new Cache<string, number>(100, { clock: () => now });
    c.set("forever", 1);
    now = 1e12;
    expect(c.get("forever")).toBe(1);
  });

  it("refreshes expiry when a key is written again", () => {
    let now = 0;
    const c = new Cache<string, number>(100, { clock: () => now });
    c.set("a", 1, 100);
    now = 80;
    c.set("a", 2, 100); // rewrite resets the clock: expires at 180
    now = 150;
    expect(c.get("a")).toBe(2); // would have died at 100, but was refreshed
    now = 200;
    expect(c.get("a")).toBeUndefined();
  });

  it("treats expired entries as absent for has and peek", () => {
    let now = 0;
    const c = new Cache<string, number>(100, { clock: () => now });
    c.set("a", 1, 10);
    now = 50;
    expect(c.has("a")).toBe(false);
    expect(c.peek("a")).toBeUndefined();
  });

  it("stays bounded and does not throw with TTLs under a flood", () => {
    let now = 0;
    const cap = 32;
    const c = new Cache<number, number>(cap, { clock: () => now, ttl: 5 });
    for (let i = 0; i < cap * 20; i++) {
      c.set(i, i);
      now += 1; // time marches, so older entries expire mid-run
      expect(c.size).toBeLessThanOrEqual(cap);
    }
  });

  it("rejects invalid ttl values", () => {
    expect(() => new Cache(10, { ttl: 0 })).toThrow(RangeError);
    expect(() => new Cache(10, { ttl: -5 })).toThrow(RangeError);
    expect(() => new Cache(10, { ttl: Infinity })).toThrow(RangeError);
    const c = new Cache<string, number>(10);
    expect(() => c.set("a", 1, 0)).toThrow(RangeError);
    expect(() => c.set("a", 1, -1)).toThrow(RangeError);
  });
});
