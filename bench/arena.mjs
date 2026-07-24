// Maintainer script: regenerate BENCHMARKS.md and its charts for caffea, using
// the cache-arena benchmark harness as the (neutral, third-party) measurement
// source. The numbers in BENCHMARKS.md come from here.
//
// Requirements: cache-arena checked out as a sibling (../cache-arena) with its
// dist built. Once cache-arena is published, replace the sibling import below
// with `import { ... } from "cache-arena"` and add it as a devDependency.
//
//   npm run bench:arena
//
// caffea is measured on the SAME seeded workloads and the SAME uniform driver as
// every other cache, so the comparison is apples to apples. caffea's default
// policy is W-TinyLFU; the `transitory` package is the other npm W-TinyLFU and is
// included for a same-family sanity check.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const ARENA_URL = new URL("../../cache-arena/dist/index.js", import.meta.url);
let arena;
try {
  arena = await import(ARENA_URL.href);
} catch (err) {
  console.error(
    "cache-arena not found. Check it out as a sibling (../cache-arena) and run\n" +
      "`npm run build` there, or (once published) `npm i -D cache-arena` and change\n" +
      "the import at the top of bench/arena.mjs to the bare specifier.\n",
  );
  throw err;
}

const {
  standardWorkloads,
  referencePolicies,
  competitors,
  adapter,
  missRatioCurves,
  throughputResults,
  buildReport,
} = arena;

const { Cache } = await import(new URL("../dist/index.js", import.meta.url).href);

// caffea as a benchmark subject. Default policy = W-TinyLFU. caffea's get()
// returns undefined on a miss and has() is a side-effect-free membership test,
// so it plugs straight into the harness with no miss-sentinel translation.
const caffea = adapter({
  name: "caffea",
  policy: "W-TinyLFU",
  source: "caffea",
  make: (capacity) => new Cache(capacity),
});

const workloads = standardWorkloads();
const { subjects: competitorSubjects, missing } = await competitors();
const subjects = [caffea, ...referencePolicies(), ...competitorSubjects];

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
      "comparison. Synthetic workloads are fixed-seed, so this run reproduces on any machine.",
  },
});

await writeFile(join(root, "BENCHMARKS.md"), report.markdown, "utf8");
for (const chart of report.charts) {
  const full = join(root, chart.path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, chart.svg, "utf8");
}

console.log(`Wrote BENCHMARKS.md and ${report.charts.length} charts under ${root}`);
