# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to adhere
to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Next

- `memo` / `adaptiveMemo` wrappers for the "cache this function" case, and an
  optional string-name policy selector (`{ policy: 'lru' }`) as a thin layer over
  the interface.

## [0.4.0]

### Changed (breaking, pre-1.0)

- The eviction policy is now pluggable. `new Cache(cap, { policy })` selects it
  and defaults to `new WTinyLFU()`, so `new Cache(cap)` behaves exactly as before.
  The `hash` and `random` options moved off the `Cache` onto `WTinyLFU`
  (`new WTinyLFU({ hash, random })`), since they only ever configured the
  W-TinyLFU sketch and admission coin.
- TTL and the eviction policy are now cleanly orthogonal: TTL correctness stays
  eager (checked on every read, whatever policy is installed), but the internal
  "an expired entry is the free eviction victim" shortcut from 0.3.0 is gone,
  because the policy no longer knows about time. Expiry is still lazy on reads.

### Added

- `EvictionPolicy<K, V>` interface and three built-in policies: `WTinyLFU`
  (the default), `LRU`, and `LFU`. Install one with `{ policy: new LRU() }`, or
  implement the interface to plug in your own. Built on the shared intrusive
  list, so every built-in is allocation-free. Exported the `Node`,
  `EvictionPolicy`, and `WTinyLFUOptions` types.
- The hit-ratio bake-off now drives the shipped policies (swapped by one line)
  instead of separate reference implementations; the numbers are byte-identical,
  which is a nice check that the built-ins match the textbook algorithms.

## [0.3.0]

### Added

- TTL (expire after write). `new Cache(cap, { ttl })` sets a cache-wide default;
  `set(key, value, ttl)` overrides it per entry; omit both and entries never
  expire. Expiry is lazy: an expired entry reads as a miss and is unlinked on the
  next access, and it is the preferred (free) victim if the eviction policy meets
  it first. The clock is injectable via `options.clock` (defaults to `Date.now`)
  so expiry is deterministic under test. Invalid TTLs throw `RangeError`. Covered
  by tests (per-entry and default expiry, override, never-expire, refresh on
  write, cleanup on access, `has` / `peek` semantics, bounded eviction with TTLs).
- Exported the `CacheOptions` type.

## [0.2.0]

### Added

- `Cache<K, V>`: a real W-TinyLFU cache. An LRU admission window (~1%) in front
  of a Segmented LRU main region (probation + protected ~80%), with the frequency
  sketch gating admission: a candidate aged out of the window is admitted only if
  it has been seen at least as often as the entry it would replace, so a one-hit
  scan cannot evict a proven-hot entry. Ties break on a coin flip (Caffeine's
  anti-hashDoS admission). Surface: `get` / `set` / `has` / `peek` / `delete` /
  `clear` and `stats()`; keys of any type (built-in hashing for strings and
  integers, overridable via `options.hash`). Built on an intrusive doubly-linked
  list for O(1) moves between segments. Covered by tests (bounded size under
  load, scan resistance, a frequently requested key winning admission, and a high
  hit ratio on a skewed workload).
- Hit-ratio bake-off (`bench/bakeoff.mjs`, `npm run bench:cache`): drives caffea,
  a textbook LRU, and a textbook in-cache LFU through identical seeded traces
  (Zipfian skew, scan pollution, and a shifting working set) and reports hit
  ratio, scoring all three with one `has`-gated driver so no key is double
  counted. caffea is the only policy that is never the worst: it beats LRU by
  ~9-10 points on skew and scan, and it beats a no-aging LFU by ~32 points on the
  shifting workload (where LFU gets stuck on stale keys).

## [0.1.0]

### Added

- `FrequencySketch`: a Count-Min Sketch with 4-bit saturating counters and
  periodic aging (the frequency estimator behind TinyLFU / W-TinyLFU admission).
  One-sided error (never underestimates), saturating at 15, recency-biased aging
  every `10 x capacity` increments. Covered by correctness tests (Count-Min
  guarantee, saturation, deterministic aging, input validation).
