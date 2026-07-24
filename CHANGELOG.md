# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to adhere
to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Next

- TTL (per-entry expiry), a pluggable eviction policy, `memo` / `adaptiveMemo`,
  and a published hit-ratio bake-off (Zipfian + bursty traces vs LRU / LFU).

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

## [0.1.0]

### Added

- `FrequencySketch`: a Count-Min Sketch with 4-bit saturating counters and
  periodic aging (the frequency estimator behind TinyLFU / W-TinyLFU admission).
  One-sided error (never underestimates), saturating at 15, recency-biased aging
  every `10 x capacity` increments. Covered by correctness tests (Count-Min
  guarantee, saturation, deterministic aging, input validation).
