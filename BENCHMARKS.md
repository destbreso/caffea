# koffein benchmark report

> Generated 2026-07-24T18:56:00.205Z · Node v22.14.0

## Method

Two axes, reported separately. **Efficiency** is the hit ratio as a function
of cache size (the miss-ratio curve), with size given as a fraction of each
workload's footprint (its distinct-key count) and **OPT**, Belady's offline
optimum, as the ceiling. This axis is a deterministic simulation and is exactly
reproducible. **Throughput** is millions of operations per second, measured with
warmup and repeated trials and reported as a mean with a 95% confidence interval.

Caches are compared at equal **memory**, not equal nominal size. A segmented
two-generation cache (quick-lru, hashlru) holds up to twice its stated size, so
it is sized to half the budget; every cache in a row occupies the same number of
entries at its peak.

Measured with cache-arena (github.com/destbreso/cache-arena). koffein's default policy is W-TinyLFU; `transitory` is the other npm W-TinyLFU, included for a same-family comparison. Workloads are fixed-seed and the reference policies and koffein are seeded, so their rows reproduce exactly; transitory has its own unseeded admission coin and may vary by a fraction of a point between runs.

## Efficiency (hit ratio vs cache size)

### zipf-0.7

*mild skew*

Footprint 19,760 distinct keys over 200,000 requests. Columns are cache size as a fraction of that footprint.

![Hit ratio vs cache size for zipf-0.7](charts/mrc-zipf-0-7.svg)

| Cache | policy | 0.10% | 0.50% | 1% | 5% | 10% | 25% |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **OPT** | _optimal_ | **12.3%** | **23.2%** | **29.5%** | **48.9%** | **59.4%** | **74.4%** |
| koffein | W-TinyLFU | 7.0% | 14.4% | 18.7% | 33.1% | 41.8% | 57.5% |
| transitory | W-TinyLFU | 7.4% | 14.4% | 18.3% | 32.4% | 41.1% | 57.3% |
| LFU | LFU | 7.5% | 13.3% | 17.3% | 32.0% | 40.9% | 56.9% |
| SIEVE | SIEVE | 7.2% | 14.3% | 18.1% | 32.2% | 41.0% | 56.9% |
| S3-FIFO | S3-FIFO | 7.8% | 15.1% | 19.3% | 33.6% | 42.0% | 56.9% |
| LRU | LRU | 1.5% | 5.8% | 9.4% | 23.5% | 33.3% | 51.9% |
| lru-cache | LRU | 1.5% | 5.8% | 9.4% | 23.5% | 33.3% | 51.9% |
| tiny-lru | LRU | 1.5% | 5.8% | 9.4% | 23.5% | 33.3% | 51.9% |
| mnemonist | LRU | 1.5% | 5.8% | 9.4% | 23.5% | 33.3% | 51.9% |
| lru.min | LRU | 1.5% | 5.8% | 9.4% | 23.5% | 33.3% | 51.9% |
| CLOCK | CLOCK | 1.4% | 5.4% | 8.9% | 22.6% | 32.3% | 50.8% |
| FIFO | FIFO | 1.4% | 5.0% | 8.1% | 20.8% | 30.0% | 48.0% |
| Random | Random | 1.4% | 5.1% | 8.1% | 20.8% | 30.1% | 48.0% |
| quick-lru | LRU (2-generation) | 1.1% | 4.6% | 7.6% | 19.7% | 28.1% | 43.5% |
| hashlru | LRU (2-generation, approx) | 1.1% | 4.6% | 7.6% | 19.7% | 28.1% | 43.5% |

### zipf-0.9

*moderate skew*

Footprint 18,500 distinct keys over 200,000 requests. Columns are cache size as a fraction of that footprint.

![Hit ratio vs cache size for zipf-0.9](charts/mrc-zipf-0-9.svg)

| Cache | policy | 0.10% | 0.50% | 1% | 5% | 10% | 25% |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **OPT** | _optimal_ | **26.9%** | **41.7%** | **48.6%** | **66.0%** | **73.8%** | **83.5%** |
| koffein | W-TinyLFU | 20.0% | 33.3% | 39.3% | 55.4% | 62.9% | 74.1% |
| LFU | LFU | 20.3% | 33.6% | 39.4% | 54.9% | 62.5% | 74.0% |
| SIEVE | SIEVE | 20.7% | 34.0% | 40.1% | 55.0% | 62.5% | 74.0% |
| S3-FIFO | S3-FIFO | 21.9% | 34.1% | 40.1% | 55.8% | 63.2% | 73.8% |
| transitory | W-TinyLFU | 21.0% | 33.2% | 39.2% | 54.7% | 60.9% | 73.8% |
| LRU | LRU | 8.9% | 21.6% | 28.3% | 46.6% | 56.1% | 70.3% |
| lru-cache | LRU | 8.9% | 21.6% | 28.3% | 46.6% | 56.1% | 70.3% |
| tiny-lru | LRU | 8.9% | 21.6% | 28.3% | 46.6% | 56.1% | 70.3% |
| mnemonist | LRU | 8.9% | 21.6% | 28.3% | 46.6% | 56.1% | 70.3% |
| lru.min | LRU | 8.9% | 21.6% | 28.3% | 46.6% | 56.1% | 70.3% |
| CLOCK | CLOCK | 8.3% | 20.6% | 27.2% | 45.5% | 55.0% | 69.3% |
| Random | Random | 7.8% | 18.5% | 24.6% | 42.3% | 51.7% | 66.3% |
| FIFO | FIFO | 7.7% | 18.4% | 24.6% | 42.3% | 51.7% | 66.3% |
| quick-lru | LRU (2-generation) | 7.2% | 18.8% | 25.0% | 42.2% | 50.9% | 63.9% |
| hashlru | LRU (2-generation, approx) | 7.2% | 18.8% | 25.0% | 42.2% | 50.9% | 63.9% |

### zipf-0.99

*YCSB default skew*

Footprint 17,049 distinct keys over 200,000 requests. Columns are cache size as a fraction of that footprint.

![Hit ratio vs cache size for zipf-0.99](charts/mrc-zipf-0-99.svg)

| Cache | policy | 0.10% | 0.50% | 1% | 5% | 10% | 25% |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **OPT** | _optimal_ | **35.2%** | **51.4%** | **58.3%** | **73.7%** | **79.9%** | **87.1%** |
| koffein | W-TinyLFU | 28.1% | 43.4% | 49.8% | 65.6% | 71.7% | 80.5% |
| LFU | LFU | 28.3% | 43.4% | 50.4% | 65.2% | 71.6% | 80.3% |
| SIEVE | SIEVE | 28.6% | 44.4% | 50.9% | 65.4% | 71.7% | 80.3% |
| transitory | W-TinyLFU | 29.0% | 43.0% | 50.0% | 64.7% | 71.3% | 80.2% |
| S3-FIFO | S3-FIFO | 30.0% | 44.4% | 50.7% | 65.8% | 72.1% | 80.1% |
| LRU | LRU | 15.3% | 32.1% | 39.6% | 58.0% | 66.3% | 77.6% |
| lru-cache | LRU | 15.3% | 32.1% | 39.6% | 58.0% | 66.3% | 77.6% |
| tiny-lru | LRU | 15.3% | 32.1% | 39.6% | 58.0% | 66.3% | 77.6% |
| mnemonist | LRU | 15.3% | 32.1% | 39.6% | 58.0% | 66.3% | 77.6% |
| lru.min | LRU | 15.3% | 32.1% | 39.6% | 58.0% | 66.3% | 77.6% |
| CLOCK | CLOCK | 14.1% | 30.9% | 38.4% | 56.9% | 65.2% | 76.7% |
| Random | Random | 13.0% | 27.8% | 35.1% | 53.5% | 62.1% | 74.1% |
| FIFO | FIFO | 13.0% | 27.8% | 35.1% | 53.6% | 62.0% | 74.0% |
| quick-lru | LRU (2-generation) | 12.6% | 28.6% | 35.8% | 53.8% | 61.7% | 72.6% |
| hashlru | LRU (2-generation, approx) | 12.6% | 28.6% | 35.8% | 53.8% | 61.7% | 72.6% |

### zipf-1.2

*steep skew*

Footprint 11,166 distinct keys over 200,000 requests. Columns are cache size as a fraction of that footprint.

![Hit ratio vs cache size for zipf-1.2](charts/mrc-zipf-1-2.svg)

| Cache | policy | 0.10% | 0.50% | 1% | 5% | 10% | 25% |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **OPT** | _optimal_ | **54.1%** | **71.7%** | **77.3%** | **87.3%** | **90.5%** | **93.5%** |
| LFU | LFU | 46.5% | 66.1% | 72.9% | 83.5% | 87.1% | 90.9% |
| SIEVE | SIEVE | 47.4% | 66.9% | 73.2% | 83.6% | 87.1% | 90.9% |
| S3-FIFO | S3-FIFO | 49.3% | 66.6% | 72.6% | 83.5% | 87.1% | 90.9% |
| koffein | W-TinyLFU | 46.4% | 66.0% | 72.3% | 83.5% | 87.1% | 90.7% |
| transitory | W-TinyLFU | 49.3% | 66.2% | 71.8% | 83.3% | 86.9% | 90.6% |
| LRU | LRU | 34.7% | 57.1% | 64.9% | 79.3% | 84.2% | 89.7% |
| lru-cache | LRU | 34.7% | 57.1% | 64.9% | 79.3% | 84.2% | 89.7% |
| tiny-lru | LRU | 34.7% | 57.1% | 64.9% | 79.3% | 84.2% | 89.7% |
| mnemonist | LRU | 34.7% | 57.1% | 64.9% | 79.3% | 84.2% | 89.7% |
| lru.min | LRU | 34.7% | 57.1% | 64.9% | 79.3% | 84.2% | 89.7% |
| CLOCK | CLOCK | 32.3% | 55.7% | 63.7% | 78.5% | 83.6% | 89.3% |
| Random | Random | 29.5% | 51.4% | 59.7% | 75.7% | 81.3% | 87.7% |
| FIFO | FIFO | 29.5% | 51.4% | 59.7% | 75.7% | 81.3% | 87.6% |
| quick-lru | LRU (2-generation) | 29.9% | 52.3% | 60.6% | 76.1% | 81.4% | 87.3% |
| hashlru | LRU (2-generation, approx) | 29.9% | 52.3% | 60.6% | 76.1% | 81.4% | 87.3% |

### scan

*hot set + periodic one-hit scans*

Footprint 19,904 distinct keys over 210,000 requests. Columns are cache size as a fraction of that footprint.

![Hit ratio vs cache size for scan](charts/mrc-scan.svg)

| Cache | policy | 0.10% | 0.50% | 1% | 5% | 10% | 25% |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **OPT** | _optimal_ | **28.9%** | **44.8%** | **52.2%** | **70.5%** | **78.4%** | **87.4%** |
| LFU | LFU | 20.7% | 35.9% | 42.7% | 59.7% | 68.2% | 80.7% |
| SIEVE | SIEVE | 22.2% | 36.9% | 43.5% | 59.9% | 68.2% | 80.7% |
| koffein | W-TinyLFU | 21.6% | 36.1% | 42.7% | 59.9% | 68.5% | 80.6% |
| transitory | W-TinyLFU | 22.1% | 35.6% | 40.4% | 59.1% | 67.4% | 80.3% |
| S3-FIFO | S3-FIFO | 23.2% | 36.7% | 43.2% | 60.1% | 68.3% | 80.2% |
| LRU | LRU | 10.4% | 24.3% | 31.4% | 51.6% | 61.9% | 76.9% |
| lru-cache | LRU | 10.4% | 24.3% | 31.4% | 51.6% | 61.9% | 76.9% |
| tiny-lru | LRU | 10.4% | 24.3% | 31.4% | 51.6% | 61.9% | 76.9% |
| mnemonist | LRU | 10.4% | 24.3% | 31.4% | 51.6% | 61.9% | 76.9% |
| lru.min | LRU | 10.4% | 24.3% | 31.4% | 51.6% | 61.9% | 76.9% |
| CLOCK | CLOCK | 9.7% | 23.2% | 30.3% | 50.4% | 60.8% | 76.0% |
| Random | Random | 8.9% | 21.0% | 27.6% | 47.2% | 57.4% | 72.9% |
| FIFO | FIFO | 9.0% | 20.9% | 27.6% | 47.0% | 57.4% | 72.7% |
| quick-lru | LRU (2-generation) | 8.2% | 21.0% | 27.8% | 46.6% | 56.1% | 70.1% |
| hashlru | LRU (2-generation, approx) | 8.2% | 21.0% | 27.8% | 46.6% | 56.1% | 70.1% |

### loop

*cyclic over 1,500 keys; LRU's worst case*

Footprint 1,500 distinct keys over 200,000 requests. Columns are cache size as a fraction of that footprint.

![Hit ratio vs cache size for loop](charts/mrc-loop.svg)

| Cache | policy | 0.10% | 0.50% | 1% | 5% | 10% | 25% |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **OPT** | _optimal_ | **0.6%** | **0.6%** | **0.9%** | **4.9%** | **9.9%** | **24.9%** |
| koffein | W-TinyLFU | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 20.8% |
| transitory | W-TinyLFU | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 13.0% |
| Random | Random | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 2.0% |
| FIFO | FIFO | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| LRU | LRU | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| LFU | LFU | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| CLOCK | CLOCK | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| SIEVE | SIEVE | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| S3-FIFO | S3-FIFO | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| lru-cache | LRU | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| tiny-lru | LRU | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| mnemonist | LRU | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| lru.min | LRU | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| quick-lru | LRU (2-generation) | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| hashlru | LRU (2-generation, approx) | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |

### shift

*working set moves every phase*

Footprint 18,804 distinct keys over 200,000 requests. Columns are cache size as a fraction of that footprint.

![Hit ratio vs cache size for shift](charts/mrc-shift.svg)

| Cache | policy | 0.10% | 0.50% | 1% | 5% | 10% | 25% |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **OPT** | _optimal_ | **33.3%** | **51.6%** | **60.0%** | **79.7%** | **86.8%** | **90.6%** |
| LRU | LRU | 12.8% | 29.9% | 38.9% | 63.8% | 76.5% | 90.6% |
| CLOCK | CLOCK | 11.9% | 28.6% | 37.6% | 62.8% | 75.7% | 90.6% |
| lru-cache | LRU | 12.8% | 29.9% | 38.9% | 63.8% | 76.5% | 90.6% |
| tiny-lru | LRU | 12.8% | 29.9% | 38.9% | 63.8% | 76.5% | 90.6% |
| mnemonist | LRU | 12.8% | 29.9% | 38.9% | 63.8% | 76.5% | 90.6% |
| lru.min | LRU | 12.8% | 29.9% | 38.9% | 63.8% | 76.5% | 90.6% |
| FIFO | FIFO | 11.0% | 25.9% | 34.4% | 59.3% | 72.7% | 90.6% |
| Random | Random | 11.1% | 25.8% | 34.3% | 59.0% | 71.9% | 86.0% |
| S3-FIFO | S3-FIFO | 26.8% | 41.8% | 49.3% | 67.7% | 76.0% | 84.5% |
| quick-lru | LRU (2-generation) | 10.5% | 25.8% | 34.2% | 57.2% | 68.8% | 84.3% |
| hashlru | LRU (2-generation, approx) | 10.5% | 25.8% | 34.2% | 57.2% | 68.8% | 84.3% |
| SIEVE | SIEVE | 25.4% | 41.5% | 48.2% | 65.4% | 66.5% | 78.4% |
| koffein | W-TinyLFU | 24.6% | 40.6% | 48.1% | 64.0% | 69.3% | 76.0% |
| transitory | W-TinyLFU | 25.6% | 40.2% | 48.1% | 62.3% | 69.6% | 75.7% |
| LFU | LFU | 7.1% | 11.2% | 14.2% | 29.6% | 42.9% | 53.5% |

### two-pool

*80% to a 500-key hot pool, 20% cold tail*

Footprint 27,805 distinct keys over 200,000 requests. Columns are cache size as a fraction of that footprint.

![Hit ratio vs cache size for two-pool](charts/mrc-two-pool.svg)

| Cache | policy | 0.10% | 0.50% | 1% | 5% | 10% | 25% |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **OPT** | _optimal_ | **23.1%** | **50.6%** | **67.1%** | **83.1%** | **84.6%** | **86.1%** |
| transitory | W-TinyLFU | 4.6% | 21.7% | 42.8% | 80.3% | 80.8% | 82.4% |
| LFU | LFU | 4.4% | 22.1% | 44.4% | 80.3% | 80.9% | 82.3% |
| SIEVE | SIEVE | 4.4% | 22.0% | 44.0% | 80.3% | 80.9% | 82.3% |
| LRU | LRU | 3.6% | 17.4% | 33.8% | 80.2% | 80.9% | 82.3% |
| lru-cache | LRU | 3.6% | 17.4% | 33.8% | 80.2% | 80.9% | 82.3% |
| tiny-lru | LRU | 3.6% | 17.4% | 33.8% | 80.2% | 80.9% | 82.3% |
| mnemonist | LRU | 3.6% | 17.4% | 33.8% | 80.2% | 80.9% | 82.3% |
| lru.min | LRU | 3.6% | 17.4% | 33.8% | 80.2% | 80.9% | 82.3% |
| koffein | W-TinyLFU | 4.3% | 21.7% | 43.9% | 80.3% | 80.8% | 82.3% |
| S3-FIFO | S3-FIFO | 4.5% | 21.7% | 42.4% | 80.3% | 80.8% | 82.3% |
| CLOCK | CLOCK | 3.6% | 17.2% | 32.9% | 79.5% | 80.7% | 82.2% |
| quick-lru | LRU (2-generation) | 2.6% | 12.9% | 24.5% | 76.0% | 80.5% | 81.6% |
| hashlru | LRU (2-generation, approx) | 2.6% | 12.9% | 24.5% | 76.0% | 80.5% | 81.6% |
| Random | Random | 3.5% | 17.0% | 31.9% | 71.4% | 77.2% | 81.2% |
| FIFO | FIFO | 3.5% | 16.9% | 31.7% | 71.4% | 77.1% | 81.1% |

## Throughput

| Cache | zipf-0.7 | zipf-0.9 | zipf-0.99 | zipf-1.2 | scan | loop | shift | two-pool |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SIEVE | 20.8 ± 0.2 | 25.4 ± 0.2 | 26.0 ± 0.8 | 36.4 ± 0.4 | 26.8 ± 0.3 | 18.5 ± 0.3 | 25.8 ± 0.4 | 27.8 ± 0.3 |
| CLOCK | 15.2 ± 0.1 | 18.7 ± 0.2 | 19.8 ± 0.4 | 30.2 ± 0.3 | 19.4 ± 0.4 | 17.4 ± 0.2 | 23.9 ± 0.2 | 26.0 ± 0.3 |
| tiny-lru | 18.6 ± 0.3 | 20.9 ± 1.2 | 24.3 ± 0.4 | 18.7 ± 0.4 | 10.8 ± 0.1 | 16.6 ± 0.0 | 28.6 ± 0.6 | 17.2 ± 0.5 |
| quick-lru | 15.4 ± 0.2 | 17.5 ± 0.1 | 18.5 ± 0.2 | 23.4 ± 0.4 | 16.3 ± 0.5 | 15.1 ± 0.0 | 19.1 ± 0.1 | 22.5 ± 0.2 |
| Random | 11.3 ± 0.1 | 15.2 ± 0.1 | 17.7 ± 0.5 | 30.0 ± 0.4 | 15.8 ± 0.3 | 11.7 ± 0.1 | 19.8 ± 1.1 | 22.8 ± 0.4 |
| mnemonist | 13.6 ± 0.1 | 16.4 ± 0.1 | 18.3 ± 0.2 | 23.8 ± 0.2 | 16.8 ± 0.1 | 13.8 ± 0.1 | 20.3 ± 0.1 | 20.1 ± 0.4 |
| lru.min | 12.4 ± 0.1 | 14.8 ± 0.2 | 16.5 ± 0.2 | 21.8 ± 0.3 | 15.1 ± 0.2 | 12.0 ± 0.4 | 18.2 ± 0.2 | 18.3 ± 0.2 |
| lru-cache | 11.0 ± 0.1 | 12.5 ± 0.2 | 14.2 ± 0.1 | 18.1 ± 0.1 | 13.2 ± 0.1 | 10.6 ± 0.3 | 14.4 ± 1.3 | 15.6 ± 0.1 |
| hashlru | 8.4 ± 0.0 | 10.1 ± 0.1 | 11.9 ± 0.1 | 19.0 ± 0.2 | 10.7 ± 0.1 | 15.1 ± 0.1 | 10.4 ± 0.1 | 16.2 ± 0.1 |
| koffein | 9.0 ± 0.1 | 9.9 ± 0.0 | 7.9 ± 0.6 | 14.2 ± 0.1 | 10.0 ± 0.1 | 6.7 ± 0.3 | 10.4 ± 0.1 | 12.0 ± 0.2 |
| transitory | 6.4 ± 0.1 | 7.8 ± 0.1 | 9.0 ± 0.1 | 12.4 ± 0.1 | 8.3 ± 0.0 | 4.7 ± 0.2 | 8.6 ± 0.1 | 9.5 ± 0.5 |
| LRU | 3.8 ± 0.0 | 5.7 ± 0.0 | 6.1 ± 0.1 | 3.6 ± 0.0 | 6.7 ± 0.0 | 6.9 ± 0.7 | 4.8 ± 1.8 | 8.8 ± 0.3 |
| FIFO | 3.0 ± 0.0 | 4.0 ± 0.0 | 4.8 ± 0.0 | 8.0 ± 0.0 | 4.8 ± 0.0 | 7.3 ± 0.1 | 7.0 ± 0.1 | 3.9 ± 0.4 |
| LFU | 3.3 ± 0.0 | 5.4 ± 0.0 | 5.7 ± 0.1 | 6.7 ± 0.1 | 5.2 ± 0.2 | 6.0 ± 0.0 | 1.8 ± 0.1 | 4.4 ± 0.1 |
| S3-FIFO | 2.2 ± 0.0 | 3.2 ± 0.0 | 4.0 ± 0.0 | 11.4 ± 0.0 | 3.7 ± 0.0 | 3.6 ± 0.0 | 4.4 ± 0.1 | 3.2 ± 0.1 |

![Throughput for zipf-0.7](charts/throughput-zipf-0-7.svg)

![Throughput for zipf-0.9](charts/throughput-zipf-0-9.svg)

![Throughput for zipf-0.99](charts/throughput-zipf-0-99.svg)

![Throughput for zipf-1.2](charts/throughput-zipf-1-2.svg)

![Throughput for scan](charts/throughput-scan.svg)

![Throughput for loop](charts/throughput-loop.svg)

![Throughput for shift](charts/throughput-shift.svg)

![Throughput for two-pool](charts/throughput-two-pool.svg)


---

Generated by [cache-arena](https://www.npmjs.com/package/cache-arena). Re-run to reproduce; the synthetic workloads are seeded and the efficiency axis is deterministic.
