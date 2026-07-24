/**
 * An intrusive doubly-linked list, the backbone of each cache segment (window,
 * probation, protected). "Intrusive" means the list does not own wrapper cells:
 * the nodes ARE the cache entries and carry their own `prev`/`next`, so an entry
 * can be unlinked from one segment and linked into another in O(1) with no
 * allocation. `head` is the most-recently-used end, `tail` the least.
 */

export class Node<K, V> {
  prev: Node<K, V> | null = null;
  next: Node<K, V> | null = null;
  /** Which segment currently holds this node (segment tags live in cache.ts). */
  segment = 0;
  /** 32-bit hash of the key, computed once, used by the frequency sketch. */
  hash = 0;
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
