// Maintainer script: regenerate BENCHMARKS.md and its charts for caffea, using
// the cache-arena benchmark harness as the (neutral, third-party) measurement
// source. The numbers in BENCHMARKS.md come from here.
//
//   npm run bench:arena
//
// cache-arena and the competitor caches it compares against are devDependencies
// (cache-arena lazy-imports the competitors, so they must be installed here for
// the full field to show up). caffea is measured on the SAME seeded workloads and
// through the SAME uniform driver as every other cache, so the comparison is
// apples to apples. caffea's default policy is W-TinyLFU; the `transitory` package
// is the other npm W-TinyLFU, included for a same-family sanity check.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  standardWorkloads,
  referencePolicies,
  competitors,
  adapter,
  missRatioCurves,
  throughputResults,
  buildReport,
  mulberry32,
} from "cache-arena";
import { Cache, WTinyLFU } from "../dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED = 1;

// caffea as a benchmark subject. Default policy = W-TinyLFU. caffea's get()
// returns undefined on a miss and has() is a side-effect-free membership test,
// so it plugs straight into the harness with no miss-sentinel translation.
// The admission gate's tie-break coin is SEEDED (a fresh deterministic stream per
// cache) so caffea's rows are exactly reproducible, not just its inputs.
const caffea = adapter({
  name: "caffea",
  policy: "W-TinyLFU",
  source: "caffea",
  make: (capacity) => new Cache(capacity, { policy: new WTinyLFU({ random: mulberry32(SEED) }) }),
});

const workloads = standardWorkloads();
const { subjects: competitorSubjects, missing } = await competitors();
// Seed the Random reference policy too, so the only residual run-to-run variation
// is transitory's own internal (unseeded) admission coin.
const subjects = [caffea, ...referencePolicies(mulberry32(SEED)), ...competitorSubjects];

console.log(`cache-arena: ${subjects.length} caches over ${workloads.length} workloads`);
if (missing.length) console.log(`(not installed, skipped: ${missing.join(", ")})`);

const mrc = missRatioCurves({ subjects, workloads, includeOpt: true });
const throughput = throughputResults({ subjects, workloads, trials: 12, warmup: 3 });

const report = buildReport({
  mrc,
  throughput,
  emphasize: "caffea",
  meta: {
    title: "caffea benchmark report",
    node: process.version,
    generatedAt: new Date().toISOString(),
    notes:
      "Measured with cache-arena (github.com/destbreso/cache-arena). caffea's default policy " +
      "is W-TinyLFU; `transitory` is the other npm W-TinyLFU, included for a same-family " +
      "comparison. Workloads are fixed-seed and the reference policies and caffea are seeded, " +
      "so their rows reproduce exactly; transitory has its own unseeded admission coin and may " +
      "vary by a fraction of a point between runs.",
  },
});

await writeFile(join(root, "BENCHMARKS.md"), report.markdown, "utf8");
for (const chart of report.charts) {
  const full = join(root, chart.path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, chart.svg, "utf8");
}

console.log(`Wrote BENCHMARKS.md and ${report.charts.length} charts under ${root}`);
