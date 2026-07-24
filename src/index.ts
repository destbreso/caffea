// Public entry point.

export { Cache } from "./cache";
export type { CacheStats, CacheOptions } from "./cache";

// Eviction policies: the default plus the built-in alternatives, and the
// interface for writing your own.
export type { EvictionPolicy } from "./policy";
export { LRU, LFU } from "./policy";
export { WTinyLFU } from "./w-tinylfu";
export type { WTinyLFUOptions } from "./w-tinylfu";

// The cache entry a custom policy receives and organizes.
export type { Node } from "./list";

// The frequency estimator behind W-TinyLFU, also usable on its own.
export { FrequencySketch } from "./frequency-sketch";
