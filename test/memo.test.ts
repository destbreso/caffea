import { describe, it, expect } from "vitest";
import { memo } from "../src/memo";

/** A promise whose settlement is controlled by the test. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let all microtasks and one macrotask turn drain. */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("memo", () => {
  it("caches sync results, calling the function once per key", () => {
    let calls = 0;
    const square = memo((x: number) => {
      calls++;
      return x * x;
    });
    expect(square(4)).toBe(16);
    expect(square(4)).toBe(16);
    expect(calls).toBe(1);
  });

  it("caches async results", async () => {
    let calls = 0;
    const load = memo(async (x: number) => {
      calls++;
      return x * x;
    });
    expect(await load(4)).toBe(16);
    expect(await load(4)).toBe(16);
    expect(calls).toBe(1);
  });

  it("de-duplicates concurrent async calls for the same key", async () => {
    let calls = 0;
    const d = deferred<number>();
    const load = memo((_id: number) => {
      calls++;
      return d.promise;
    });
    const p1 = load(1);
    const p2 = load(1); // same key, before the first resolves
    expect(calls).toBe(1); // one in-flight computation, shared
    expect(p1).toBe(p2); // literally the same promise
    d.resolve(42);
    expect(await p1).toBe(42);
    expect(await p2).toBe(42);
  });

  it("does not cache a rejected promise", async () => {
    let calls = 0;
    const load = memo(async (_id: number) => {
      calls++;
      if (calls === 1) throw new Error("boom");
      return "ok";
    });
    await expect(load(1)).rejects.toThrow("boom");
    await tick(); // let the reject-eviction run
    const second = await load(1);
    expect(second).toBe("ok");
    expect(calls).toBe(2); // retried, not served the cached failure
  });

  it("keys on all arguments with a custom keyFn", () => {
    let calls = 0;
    const add = memo(
      (a: number, b: number) => {
        calls++;
        return a + b;
      },
      { keyFn: (a, b) => `${a}:${b}` },
    );
    add(1, 2);
    add(1, 2); // same key -> hit
    add(1, 3); // different second arg -> a distinct key (the default first-arg
    //           key would have wrongly collided these two)
    expect(calls).toBe(2);
  });

  it("expires memoized results after ttl", () => {
    let now = 0;
    let calls = 0;
    const load = memo(
      (x: number) => {
        calls++;
        return x * 2;
      },
      { ttl: 100, clock: () => now },
    );
    expect(load(5)).toBe(10);
    expect(load(5)).toBe(10);
    expect(calls).toBe(1); // cached
    now = 150;
    expect(load(5)).toBe(10);
    expect(calls).toBe(2); // recomputed after expiry
  });

  it("delete invalidates one call and clear drops all", () => {
    let calls = 0;
    const id = memo((x: number) => {
      calls++;
      return x;
    });
    id(1);
    id(2);
    id(1); // hit
    expect(calls).toBe(2);
    expect(id.delete(1)).toBe(true);
    id(1); // recompute
    expect(calls).toBe(3);
    id.clear();
    id(2); // recompute
    expect(calls).toBe(4);
  });

  it("reports hits and misses through stats", () => {
    const id = memo((x: number) => x);
    id(1); // miss
    id(1); // hit
    id(2); // miss
    const s = id.stats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(2);
  });
});
