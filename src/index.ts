// Public entry point.

export { Cache } from "./cache";
export type { CacheStats, CacheOptions } from "./cache";

// Eviction policies: the default plus the built-in alternatives, and the
// interface for writing your own.
export type { EvictionPolicy } from "./policy";
export { LRU, LFU } from "./policy";
export { WTinyLFU } from "./w-tinylfu";
export type { WTinyLFUOptions } from "./w-tinylfu";

// The name registry behind string policy selection (`{ policy: "lru" }`), and
// how you make your own policy selectable by name.
export { registerPolicy, policyNames } from "./registry";
export type { PolicyFactory } from "./registry";

// The cache entry a custom policy receives and organizes.
export type { Node } from "./list";

// Memoize a function on top of the cache (async-aware, with in-flight dedup).
export { memo } from "./memo";
export type { MemoOptions, Memoized } from "./memo";

// The frequency estimator behind W-TinyLFU, also usable on its own.
export { FrequencySketch } from "./frequency-sketch";
