# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to adhere
to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `FrequencySketch`: a Count-Min Sketch with 4-bit saturating counters and
  periodic aging (the frequency estimator behind TinyLFU / W-TinyLFU admission).
  One-sided error (never underestimates), saturating at 15, recency-biased aging
  every `10 x capacity` increments. Covered by correctness tests (Count-Min
  guarantee, saturation, deterministic aging, input validation).

- `Cache`: a fixed-capacity cache with the W-TinyLFU storage layout, an LRU
  admission window in front of a Segmented LRU main region (probation and
  protected), plus `get` / `set` / `has` / `peek` / `delete` / `clear` and
  `stats()`. Built on an intrusive doubly-linked list so entries move between
  segments in O(1). Covered by tests (bounded size under load, a hot key
  surviving a scan, tiny capacities). The admission decision is a single seam
  that currently always admits.

### Next

- The frequency-based admission gate: wire the sketch so a one-hit scan key
  cannot evict a proven-hot entry (this is what makes it W-TinyLFU). Then TTL, a
  pluggable eviction policy, and the hit-ratio bake-off harness.
