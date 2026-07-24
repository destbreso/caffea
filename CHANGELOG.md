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

### Next

- Window (LRU) + Segmented LRU main, admission gate, cache surface with TTL and
  stats, pluggable eviction policy, and the hit-ratio bake-off harness.
