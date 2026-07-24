import { describe, it, expect } from "vitest";
import { Cache } from "../src/cache";
import { LRU, LFU, type EvictionPolicy } from "../src/policy";
import { Node, IntrusiveList } from "../src/list";

describe("LRU policy", () => {
  it("evicts the least recently used entry", () => {
    const c = new Cache<string, number>(3, { policy: new LRU() });
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    c.get("a"); // touch a, so b is now the least recently used
    c.set("d", 4); // over capacity -> evict b
    expect(c.has("a")).toBe(true);
    expect(c.has("b")).toBe(false);
    expect(c.has("c")).toBe(true);
    expect(c.has("d")).toBe(true);
    expect(c.size).toBe(3);
  });

  it("stays bounded under a flood", () => {
    const cap = 16;
    const c = new Cache<number, number>(cap, { policy: new LRU() });
    for (let i = 0; i < cap * 10; i++) {
      c.set(i, i);
      expect(c.size).toBeLessThanOrEqual(cap);
    }
    expect(c.has(cap * 10 - 1)).toBe(true); // newest is resident
  });
});

describe("LFU policy", () => {
  it("evicts the least frequently used entry", () => {
    const c = new Cache<string, number>(3, { policy: new LFU() });
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    c.get("a");
    c.get("a"); // a: freq 3
    c.get("b"); // b: freq 2, c stays freq 1
    c.set("d", 4); // over capacity -> evict the coldest, c
    expect(c.has("c")).toBe(false);
    expect(c.has("a")).toBe(true);
    expect(c.has("b")).toBe(true);
    expect(c.has("d")).toBe(true);
  });

  it("always admits a fresh key, displacing an incumbent", () => {
    const c = new Cache<number, number>(2, { policy: new LFU() });
    c.set(1, 1);
    c.get(1);
    c.get(1); // key 1 is hot (freq 3)
    c.set(2, 2); // freq 1
    c.set(3, 3); // over capacity -> evicts the colder incumbent (2), not the newcomer
    expect(c.has(1)).toBe(true);
    expect(c.has(2)).toBe(false);
    expect(c.has(3)).toBe(true);
  });
});

describe("custom policy through the interface", () => {
  // A minimal FIFO: evicts in insertion order, indifferent to reads. Proving the
  // interface is usable end to end, and that a no-op onAccess really changes
  // behavior (unlike LRU, a read does not save an entry here).
  class FIFO<K, V> implements EvictionPolicy<K, V> {
    private readonly list = new IntrusiveList<K, V>();
    private cap = 0;
    init(capacity: number): void {
      this.cap = capacity;
    }
    onAdd(node: Node<K, V>): Node<K, V> | null {
      this.list.pushHead(node);
      return this.list.size > this.cap ? this.list.popTail() : null;
    }
    onAccess(): void {
      /* FIFO ignores reads */
    }
    onMiss(): void {}
    onRemove(node: Node<K, V>): void {
      this.list.remove(node);
    }
    clear(): void {
      this.list.clear();
    }
  }

  it("evicts in insertion order regardless of access", () => {
    const c = new Cache<string, number>(2, { policy: new FIFO() });
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // a read that would save "a" under LRU, but FIFO does not care
    c.set("c", 3); // over capacity -> evict the oldest, "a"
    expect(c.has("a")).toBe(false);
    expect(c.has("b")).toBe(true);
    expect(c.has("c")).toBe(true);
  });
});

describe("TTL is orthogonal to the policy", () => {
  it("expires entries under a non-default policy", () => {
    let now = 0;
    const c = new Cache<string, number>(10, {
      policy: new LRU(),
      clock: () => now,
      ttl: 100,
    });
    c.set("a", 1);
    now = 50;
    expect(c.get("a")).toBe(1);
    now = 150;
    expect(c.get("a")).toBeUndefined(); // expired even with LRU installed
    expect(c.size).toBe(0);
  });
});
