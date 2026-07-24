/**
 * A cache entry, and the unit an eviction policy organizes. It carries its own
 * `prev`/`next` so it can live in an intrusive doubly-linked list (see below):
 * the node IS the list cell, so a policy can unlink it from one list and link it
 * into another in O(1) with no allocation.
 *
 * `key`, `value`, and `expiresAt` belong to the cache (identity, payload, TTL).
 * `segment`, `hash`, and `freq` are scratch space the installed eviction policy
 * uses however it likes; a policy that does not need a field simply ignores it
 * (an LRU never touches `hash` or `freq`, an LFU never touches `segment`). This
 * keeps every policy allocation-free at the cost of a few unused number fields
 * per entry, which for a cache is a rounding error.
 */
export class Node<K, V> {
  prev: Node<K, V> | null = null;
  next: Node<K, V> | null = null;
  /** Policy scratch: a segment/state tag (W-TinyLFU uses window/probation/protected). */
  segment = 0;
  /** Policy scratch: a 32-bit hash of the key (W-TinyLFU's frequency sketch). */
  hash = 0;
  /** Policy scratch: an access-frequency counter (LFU's bucket level). */
  freq = 0;
  /** Absolute expiry in clock-ms; `Infinity` means the entry never expires. */
  expiresAt = Infinity;
  constructor(
    public key: K,
    public value: V,
  ) {}
}

export class IntrusiveList<K, V> {
  head: Node<K, V> | null = null; // MRU
  tail: Node<K, V> | null = null; // LRU
  size = 0;

  /** Link `n` at the head (most-recently-used). `n` must be detached. */
  pushHead(n: Node<K, V>): void {
    n.prev = null;
    n.next = this.head;
    if (this.head) this.head.prev = n;
    else this.tail = n;
    this.head = n;
    this.size++;
  }

  /** Unlink `n`; it must currently belong to this list. */
  remove(n: Node<K, V>): void {
    if (n.prev) n.prev.next = n.next;
    else this.head = n.next;
    if (n.next) n.next.prev = n.prev;
    else this.tail = n.prev;
    n.prev = null;
    n.next = null;
    this.size--;
  }

  /** Unlink and return the least-recently-used node, or null if empty. */
  popTail(): Node<K, V> | null {
    const n = this.tail;
    if (n) this.remove(n);
    return n;
  }

  /** Move an existing member to the head (records a use). */
  moveToHead(n: Node<K, V>): void {
    if (n === this.head) return;
    this.remove(n);
    this.pushHead(n);
  }

  clear(): void {
    this.head = null;
    this.tail = null;
    this.size = 0;
  }
}
