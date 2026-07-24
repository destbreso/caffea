import { describe, it, expect } from "vitest";
import { Cache } from "../src/cache";
import { registerPolicy, policyNames, createPolicy } from "../src/registry";
import { LRU, type EvictionPolicy } from "../src/policy";
import { Node, IntrusiveList } from "../src/list";

// A custom policy (FIFO), the same one policy.test.ts installs by instance. Here
// it is installed by NAME, which is the whole point of the registry.
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
  onAccess(): void {}
  onMiss(): void {}
  onRemove(node: Node<K, V>): void {
    this.list.remove(node);
  }
  clear(): void {
    this.list.clear();
  }
}

describe("policy registry", () => {
  it("selects the built-ins by name", () => {
    const lru = new Cache<string, number>(3, { policy: "lru" });
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);
    lru.get("a"); // touch a; b becomes least recently used
    lru.set("d", 4); // evict b
    expect(lru.has("b")).toBe(false);
    expect(lru.has("a")).toBe(true);

    const lfu = new Cache<string, number>(2, { policy: "lfu" });
    lfu.set("x", 1);
    lfu.get("x"); // x is hot
    lfu.set("y", 2);
    lfu.set("z", 3); // evict the colder y, not x
    expect(lfu.has("x")).toBe(true);
    expect(lfu.has("y")).toBe(false);
  });

  it("defaults, and the name 'w-tinylfu', are scan-resistant", () => {
    const c = new Cache<string, string>(50, { policy: "w-tinylfu" });
    c.set("hot", "H");
    for (let i = 0; i < 500; i++) {
      c.set(`cold-${i}`, "c");
      if (i % 2 === 0) c.get("hot");
    }
    expect(c.has("hot")).toBe(true);
  });

  it("throws a helpful error for an unknown name", () => {
    expect(() => new Cache(10, { policy: "nope" })).toThrow(RangeError);
    expect(() => new Cache(10, { policy: "nope" })).toThrow(/Unknown eviction policy/);
    expect(() => createPolicy("nope")).toThrow(/Registered:/); // lists the known names
  });

  it("selects a user-registered custom policy by name", () => {
    registerPolicy("fifo", () => new FIFO());
    expect(policyNames()).toContain("fifo");

    const c = new Cache<string, number>(2, { policy: "fifo" });
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // a read FIFO ignores (unlike LRU)
    c.set("c", 3); // evict the oldest, a
    expect(c.has("a")).toBe(false);
    expect(c.has("b")).toBe(true);
    expect(c.has("c")).toBe(true);
  });

  it("gives each cache its own policy instance", () => {
    const c1 = new Cache<number, number>(2, { policy: "lru" });
    const c2 = new Cache<number, number>(2, { policy: "lru" });
    c1.set(1, 1);
    c1.set(2, 2);
    c1.set(3, 3); // c1 evicts, c2 is untouched
    expect(c1.size).toBe(2);
    expect(c2.size).toBe(0);
  });

  it("lists the built-in names and lets a name be overridden (last wins)", () => {
    expect(policyNames()).toEqual(
      expect.arrayContaining(["w-tinylfu", "lru", "lfu"]),
    );

    // First register the name as an LRU alias, and confirm LRU behavior.
    registerPolicy("swap", () => new LRU());
    const asLru = new Cache<string, number>(2, { policy: "swap" });
    asLru.set("a", 1);
    asLru.set("b", 2);
    asLru.get("a"); // touch a
    asLru.set("c", 3); // LRU evicts b, since a was just used
    expect(asLru.has("a")).toBe(true);

    // Re-register the same name as FIFO; the newer factory wins.
    registerPolicy("swap", () => new FIFO());
    const asFifo = new Cache<string, number>(2, { policy: "swap" });
    asFifo.set("a", 1);
    asFifo.set("b", 2);
    asFifo.get("a"); // FIFO ignores the touch
    asFifo.set("c", 3); // FIFO evicts the oldest, a
    expect(asFifo.has("a")).toBe(false);
  });
});
