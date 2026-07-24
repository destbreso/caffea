# caffea

[![npm](https://img.shields.io/npm/v/caffea.svg)](https://www.npmjs.com/package/caffea)
[![license](https://img.shields.io/npm/l/caffea.svg)](./LICENSE)
[![types](https://img.shields.io/badge/types-TypeScript-blue.svg)](./src)
![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)

A modern, zero-dependency cache for JavaScript and TypeScript with a **pluggable
eviction policy**. Its headline policy is **W-TinyLFU**: a frequency-based
admission filter in front of a Segmented LRU, which keeps the *hot set* resident
and beats plain LRU on skewed (Zipfian) and bursty workloads without giving up
recency.

This is not "another LRU". [`lru-cache`](https://www.npmjs.com/package/lru-cache)
already owns the LRU default and does it well. The wedge here is the eviction
*quality* niche that JavaScript lost when its only real W-TinyLFU port
(`transitory`) went unmaintained: a measurably higher hit ratio on real traces,
with the policy swappable so you can run your own bake-off. This is my take on
that gap, not the one true cache.

> ### Status: early release (0.2.x)
> The **`Cache`** is here, and it is real W-TinyLFU: an LRU admission window in
> front of a Segmented LRU main region, with a frequency sketch gating admission
> so a scan cannot evict your hot set. TTL, a pluggable eviction policy, and the
> published hit-ratio bake-off are landing next. The version is `0.x` on purpose:
> the API can still move. See the [roadmap](#roadmap).

## Install

```sh
npm install caffea
```

Ships ESM and CommonJS builds with type declarations. Node >= 18. Zero runtime
dependencies.

## Why W-TinyLFU

- **LRU leaves hit ratio on the table.** On skewed access it evicts a hot key
  the moment a burst of one-hit-wonders scans through (the classic "scan
  pollution"). Pure LFU fixes that but never forgets, so a key that was hot
  yesterday lingers forever.
- **W-TinyLFU** keeps a small **window** (an LRU that catches recency and bursts)
  in front of a **Segmented LRU main**, and only *admits* a candidate into the
  main cache when a compact **frequency sketch** says it is hotter than the
  victim it would replace. The sketch **ages** periodically, so admission stays
  recency-aware instead of frozen in the past. This is the design behind
  [Caffeine](https://github.com/ben-manes/caffeine), the reference JVM cache.

## Quick start

```ts
import { Cache } from "caffea";

const cache = new Cache<string, User>(10_000); // hold up to 10k entries

cache.set("user:42", user);
cache.get("user:42"); //  => user
cache.get("user:999"); // => undefined (a miss)

cache.has("user:42"); //  => true
cache.peek("user:42"); // read without counting it as a use
cache.delete("user:42");
cache.stats(); // { size, capacity, hits, misses, evictions, hitRatio }
```

Keys can be any type. String and integer keys are hashed for you; for other key
shapes pass your own `hash`:

```ts
new Cache<MyKey, V>(1000, { hash: (k) => k.id });
```

### Why it holds up under scans

The cache records every access in a frequency sketch, and when it is full it
admits a newcomer into the main region only if the sketch says that newcomer has
been seen at least as often as the entry it would replace. A key touched once (a
scan, a crawler, a one-off report) cannot evict a proven-hot entry, which is
exactly where a plain LRU bleeds hit ratio.

## Cache API

### `new Cache<K, V>(capacity, options?)`
A W-TinyLFU cache holding up to `capacity` entries. `options.hash?: (key: K) =>
number` overrides the default key hasher; `options.random?: () => number`
overrides the admission tie-break source (useful for deterministic tests).
Throws `RangeError` if `capacity` is not a positive integer.

### `cache.get(key)` / `cache.set(key, value)`
Read (recording a use, which can promote the entry) and insert-or-update.

### `cache.peek(key)` / `cache.has(key)` / `cache.delete(key)` / `cache.clear()`
`peek` reads without recording a use; the others are the obvious operations.

### `cache.stats()` / `cache.size` / `cache.capacity`
`stats()` returns `{ size, capacity, hits, misses, evictions, hitRatio }`.

## The frequency sketch (also usable on its own)

`FrequencySketch` is a Count-Min Sketch with 4-bit saturating counters and
periodic aging: the frequency estimator behind TinyLFU admission, and the engine
the `Cache` uses internally. It is exported on its own for any "how hot is this
key, approximately and cheaply" question.

```ts
import { FrequencySketch } from "caffea";

const sketch = new FrequencySketch(1000); // tuned for ~1000 live entries

// The sketch works on a 32-bit numeric hash of your key. Any integer works:
// it runs a murmur3 finalizer internally, so even low-entropy ids spread well.
sketch.increment(42);
sketch.increment(42);
sketch.increment(42);

sketch.frequency(42); // => 3   (an estimate; never below the true count)
sketch.frequency(7); //  => 0   (never seen)
```

### Hashing string keys

The sketch takes a number so it stays a pure primitive. For string keys, hash
them first (the `Cache` does this for you; here is a compact FNV-1a, the same one
it uses, for the sketch on its own):

```ts
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

sketch.increment(fnv1a("user:1042"));
sketch.frequency(fnv1a("user:1042")); // => 1
```

### Aging

Aging is automatic: once the sketch observes `10 x capacity` increments, every
counter is halved, so recent activity outweighs the distant past. You can also
trigger it manually to decay the whole sketch on demand:

```ts
const s = new FrequencySketch(500);
for (let i = 0; i < 15; i++) s.increment(99); // saturates at 15
s.reset();
s.frequency(99); // => 7   (15 >> 1)
```

## API

### `new FrequencySketch(capacity: number)`
Creates a sketch tuned for roughly `capacity` live entries. Internally sizes to
the next power of two and 4 hash rows. Throws `RangeError` if `capacity` is not a
positive integer.

### `sketch.increment(hash: number): void`
Records one occurrence of `hash`. Increments 4 counters (one per row, all
distinct) up to a ceiling of 15, and ages the sketch when the sample fills.

### `sketch.frequency(hash: number): number`
Returns the estimated count of `hash`, in `0..15`. The estimate is the **minimum**
across the 4 rows, so it can overestimate on a hash collision but **never
underestimates** the true count. That one-sided error is exactly what an
admission filter wants: better to admit a cold key than reject a hot one.

### `sketch.reset(): void`
Halves every counter (recency-biased aging). Called automatically at the sample
threshold; exposed for manual decay and inspection.

### `sketch.clear(): void`
Drops all state.

### `sketch.size` / `sketch.capacity` / `sketch.sampleSize` (readonly)
Diagnostics: increments observed since the last aging reset, the configured
capacity, and the increment count that triggers aging (`10 x capacity`).

## Design notes

- **One-sided error.** Count-Min never underestimates. A cache does not need the
  true frequency, only "is this key hotter than the victim it would evict", so a
  saturating 4-bit counter (0..15) is enough and keeps the whole sketch tiny:
  eight counters packed per 32-bit word.
- **Distinct rows.** The 4 rows use double hashing `g_i = h1 + i * h2` with an
  odd stride, so a key's 4 counters never collide with each other. Only *other*
  keys can inflate an estimate, and only upward.
- **Aging keeps it honest.** Halving on a schedule is what separates TinyLFU from
  a plain frequency counter: yesterday's hot key decays instead of dominating.

## Roadmap

- [x] `FrequencySketch` (Count-Min + 4-bit counters + aging) with correctness tests
- [x] `Window` (LRU ~1%) + `SLRU` main (probation / protected ~80%)
- [x] Admission gate: candidate-vs-victim frequency + randomized tie-break
- [x] `Cache`: `get / set / has / delete / peek / clear`, `.stats()`
- [ ] TTL (per-entry expiry)
- [ ] Pluggable `EvictionPolicy` interface (LRU / LFU / W-TinyLFU)
- [ ] `memo` / `adaptiveMemo`
- [ ] Published hit-ratio bake-off (seeded Zipfian + bursty traces vs LRU / LFU)

Out of scope for v1: ARC and S3-FIFO (behind the policy interface later),
adaptive window resizing, and any distributed or multi-backend store (that is
[`keyv`](https://www.npmjs.com/package/keyv)'s job; caffea stays in-memory).

## References

The design rests on published, peer-reviewed work. Verified citations:

1. G. Einziger, R. Friedman, B. Manes. **TinyLFU: A Highly Efficient Cache
   Admission Policy.** ACM Transactions on Storage 13(4), Article 35, 2017.
   [DOI:10.1145/3149371](https://dl.acm.org/doi/10.1145/3149371) ·
   [arXiv:1512.00727](https://arxiv.org/abs/1512.00727)
2. G. Cormode, S. Muthukrishnan. **An Improved Data Stream Summary: The Count-Min
   Sketch and its Applications.** Journal of Algorithms 55(1):58-75, 2005.
   [DOI:10.1016/j.jalgor.2003.12.001](https://doi.org/10.1016/j.jalgor.2003.12.001)
3. A. Kirsch, M. Mitzenmacher. **Less Hashing, Same Performance: Building a Better
   Bloom Filter.** ESA 2006, LNCS 4168, pp. 456-467 (the `g_i = h1 + i*h2` double
   hashing used here). Journal version: Random Structures & Algorithms
   33(2):187-218, 2008.
   [DOI:10.1007/11841036_42](https://doi.org/10.1007/11841036_42)
4. R. Karedla, J. S. Love, B. G. Wherry. **Caching Strategies to Improve Disk
   System Performance.** IEEE Computer 27(3):38-46, 1994 (Segmented LRU).
   [DOI:10.1109/2.268884](https://doi.org/10.1109/2.268884)
5. B. Manes. **Caffeine**, the reference W-TinyLFU cache for the JVM.
   [github.com/ben-manes/caffeine](https://github.com/ben-manes/caffeine)
6. A. Appleby. **MurmurHash3** (the `fmix32` finalizer used to spread hashes).
   [github.com/aappleby/smhasher](https://github.com/aappleby/smhasher)

## License

MIT (c) David Estevez
