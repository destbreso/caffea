# koffein

[![npm](https://img.shields.io/npm/v/koffein.svg)](https://www.npmjs.com/package/koffein)
[![license](https://img.shields.io/npm/l/koffein.svg)](./LICENSE)
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

> ### Status: early release (0.5.x)
> The **`Cache`** is here with a real, scan-resistant **W-TinyLFU** by default,
> optional per-entry **TTL**, a **pluggable eviction policy** (`WTinyLFU`, `LRU`,
> `LFU`, or your own), and **`memo`** for caching sync or async functions with
> in-flight de-duplication. A reproducible hit-ratio bake-off backs the claims.
> The core is feature-complete; the version is `0.x` while the API settles toward
> 1.0. See the [roadmap](#roadmap).

## Install

```sh
npm install koffein
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

## Benchmarks

koffein is measured against plain LRU, the popular npm caches, and the modern
research policies (SIEVE, S3-FIFO, LFU) with an independent harness,
[cache-arena](https://github.com/destbreso/cache-arena), on the same seeded
workloads and through the same uniform driver. Caches are compared at equal
**memory** (a segmented cache that secretly holds 2x its nominal size is sized
down to match). Full tables, every workload, and the methodology live in
[BENCHMARKS.md](./BENCHMARKS.md); the short version:

**Hit ratio (efficiency).** On skewed (Zipfian) traffic, the common case, koffein
returns markedly more hits than plain LRU at the same memory, and the gap is
widest exactly where a cache hurts most: when it is small relative to the working
set.

| Zipf 0.99, cache size | koffein (W-TinyLFU) | plain LRU | vs LRU |
| --- | ---: | ---: | ---: |
| 0.1% of footprint | 28.1% | 15.3% | +84% |
| 1% of footprint | 49.8% | 39.6% | +26% |
| 10% of footprint | 71.7% | 66.3% | +8% |

koffein lands in the top group with LFU, SIEVE and S3-FIFO, a hair under Belady's
optimal (OPT), and it tracks `transitory` (the other npm W-TinyLFU) to within a
rounding error: a cross-check that the implementation is sound. On a pure **loop**
larger than the cache (LRU's textbook worst case) koffein is the only family that
recovers any hits at all.

![koffein vs the field on YCSB-skew Zipf](https://raw.githubusercontent.com/destbreso/koffein/main/charts/mrc-zipf-0-99.svg)

**Throughput (the honest tradeoff).** Admission control is not free: koffein does
more work per operation (a sketch lookup, sometimes an eviction decision) than a
bare LRU map, so it is not the throughput leader. If your traffic is uniform or
your cache comfortably holds the working set, LRU's simplicity may serve you
better. koffein earns its keep when hit ratio is what matters and memory is tight.
Efficiency numbers above are exact (a deterministic simulation); throughput is
per-machine and per-implementation, reported with 95% confidence intervals in
[BENCHMARKS.md](./BENCHMARKS.md).

## Quick start

```ts
import { Cache } from "koffein";

const cache = new Cache<string, User>(10_000); // hold up to 10k entries

cache.set("user:42", user);
cache.get("user:42"); //  => user
cache.get("user:999"); // => undefined (a miss)

cache.has("user:42"); //  => true
cache.peek("user:42"); // read without counting it as a use
cache.delete("user:42");
cache.stats(); // { size, capacity, hits, misses, evictions, hitRatio }
```

Keys can be any type. String and integer keys are hashed for you by the default
policy; for other key shapes, pass a `hash` to `WTinyLFU` (see
[Choosing a policy](#choosing-a-policy)).

### Expiry (TTL)

Give entries a time-to-live, cache-wide or per entry. Expiry is lazy: an expired
entry reads as a miss and frees its slot on the next touch, so there are no
timers to manage.

```ts
const sessions = new Cache<string, Session>(10_000, { ttl: 60_000 }); // 60s default
sessions.set("sid:abc", session); //           expires 60s after this write
sessions.set("sid:xyz", session, 5 * 60_000); // this one lives 5 minutes
```

### Why it holds up under scans

The cache records every access in a frequency sketch, and when it is full it
admits a newcomer into the main region only if the sketch says that newcomer has
been seen at least as often as the entry it would replace. A key touched once (a
scan, a crawler, a one-off report) cannot evict a proven-hot entry, which is
exactly where a plain LRU bleeds hit ratio.

## Choosing a policy

The cache delegates every eviction decision to a policy. The default is
`WTinyLFU`; swap it with one line, or bring your own.

```ts
import { Cache, WTinyLFU, LRU, LFU } from "koffein";

new Cache(cap); //                       W-TinyLFU (the default)
new Cache(cap, { policy: new LRU() }); // plain LRU
new Cache(cap, { policy: new LFU() }); // plain LFU (in-cache counts, no aging)
```

- **`WTinyLFU`** (default) is the scan-resistant, skew-friendly policy the rest
  of this README is about. It takes its own tuning via
  `new WTinyLFU({ hash, random })`: `hash` maps a key to a 32-bit integer for the
  frequency sketch (strings and integers are handled for you), and `random` is
  the admission tie-break source (inject a seeded one for deterministic tests).
- **`LRU`** and **`LFU`** are honest, textbook baselines, offered so you can
  measure the gap on *your own* traffic instead of taking the bake-off's word for
  it. Install each behind the same `Cache` and compare `stats().hitRatio`.

Write your own by implementing `EvictionPolicy<K, V>`: `init(capacity)`,
`onAdd(node)` (returns a victim to evict or `null`), `onAccess(node)`,
`onMiss(key)`, `onRemove(node)`, and `clear()`. The `Node` and `EvictionPolicy`
types are exported for this. TTL is orthogonal and works behind any policy.

### Selecting a policy by name

A policy can also be chosen by a registered name, and you can register your own so
it is selectable exactly like a built-in:

```ts
import { Cache, registerPolicy, policyNames } from "koffein";

new Cache(cap, { policy: "lru" }); // built-in names: "w-tinylfu", "lru", "lfu"

registerPolicy("my-policy", () => new MyPolicy());
new Cache(cap, { policy: "my-policy" }); // your policy, selected by name

policyNames(); // => ["w-tinylfu", "lru", "lfu", "my-policy"]
```

The registry stores factories, so each cache gets a fresh instance, and an
unknown name throws. Instance and string forms coexist: pass an instance when you
need to configure it (`new WTinyLFU({ hash })`) or want full type checking, a name
when the default of a policy is all you want.

## Memoizing a function

`memo` wraps a function so its results are cached, with the whole W-TinyLFU (and
optional TTL) machine underneath. It is async-aware where it counts.

```ts
import { memo } from "koffein";

const getUser = memo(fetchUser, { capacity: 10_000, ttl: 60_000 });

await getUser(42); // runs fetchUser(42), caches the result
await getUser(42); // served from cache
```

For async functions it caches the **promise**, so two concurrent calls for the
same key share a single in-flight computation (the function runs once, not once
per caller). If that promise rejects, the entry is evicted, so a failure is never
cached and the next call retries.

Keys default to the first argument. For multi-argument functions, pass a `keyFn`:

```ts
const distance = memo(computeDistance, { keyFn: (from, to) => `${from}->${to}` });
```

`capacity` (default 1000), `ttl`, `clock`, and `policy` pass through to the
underlying cache. The memoized function also carries `.delete(...args)` to
invalidate one call, `.clear()`, `.stats()`, and `.cache` for direct access.

## Cache API

### `new Cache<K, V>(capacity, options?)`
A cache holding up to `capacity` entries. Options: `policy?: EvictionPolicy`
selects the eviction strategy (default `new WTinyLFU()`; see
[Choosing a policy](#choosing-a-policy)); `ttl?: number` sets a default per-entry
lifetime in milliseconds (omit for no expiry); `clock?: () => number` overrides
the time source (defaults to `Date.now`, injectable for deterministic tests).
Throws `RangeError` if `capacity` is not a positive integer or `ttl` is not
positive. (Key hashing and the admission RNG are configured on `WTinyLFU`, not
here.)

### `cache.get(key)` / `cache.set(key, value, ttl?)`
Read (recording a use, which can promote the entry) and insert-or-update. A
per-call `ttl` (milliseconds) overrides the cache-wide default for that entry,
and every write refreshes the entry's expiry.

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
import { FrequencySketch } from "koffein";

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
- [x] TTL (cache-wide default + per-call override, injectable clock)
- [x] Hit-ratio bake-off (seeded Zipfian / scan / shifting traces vs LRU / LFU)
- [x] Pluggable `EvictionPolicy` interface (`WTinyLFU` / `LRU` / `LFU` / your own)
- [x] `memo` (sync/async, in-flight de-duplication, a rejected result not cached)
- [x] Extensible string-name policy selector (`{ policy: 'lru' }`, `registerPolicy`)

Out of scope for v1: ARC and S3-FIFO (behind the policy interface later),
adaptive window resizing, and any distributed or multi-backend store (that is
[`keyv`](https://www.npmjs.com/package/keyv)'s job; koffein stays in-memory).

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
