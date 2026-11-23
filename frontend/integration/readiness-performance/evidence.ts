import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, cpus, release, totalmem } from "node:os";

export const warmups = 5;
export const samples = 50;

function readLimit(name: string) {
  try {
    return readFileSync("/sys/fs/cgroup/" + name, "utf8").trim();
  } catch {
    return null;
  }
}

export function environment(browser: string) {
  const cpu = cpus();
  return {
    browser,
    clientCPU: cpu[0]?.model,
    clientLogicalCPUs: cpu.length,
    clientAvailableCPUs: availableParallelism(),
    clientMemoryBytes: totalmem(),
    linuxKernel: release(),
    clientArchitecture: process.arch,
    cpuQuota: readLimit("cpu.max"),
    memoryLimitBytes: readLimit("memory.max"),
    cpuSet: readLimit("cpuset.cpus.effective"),
    viewport: { width: 1440, height: 900 },
    transport:
      "Chromium and the web process share the disposable loopback network namespace",
  };
}

type Metric = {
  budgetMs: number;
  observedMs: number;
  statistic: "p95" | "single";
  passed: boolean;
  warmupMs: number[];
  samplesMs: number[];
};
export function nearestRank(values: readonly number[], percentile: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * percentile) - 1];
}

export function recorder(browserVersion: string) {
  const result = {
    complete: false,
    environment: environment(browserVersion),
    measurements: {} as Record<string, Metric>,
    observations: {} as Record<string, unknown>,
    currentPhase: "initializing",
  };
  const flush = () =>
    writeFileSync("/run/benchmark-report.json", JSON.stringify(result));
  function observe(name: string, value: unknown) {
    result.observations[name] = value;
    flush();
  }
  function phase(name: string) {
    result.currentPhase = name;
    flush();
  }
  function record(
    name: string,
    budgetMs: number,
    warmupMs: number[],
    samplesMs: number[],
    statistic: Metric["statistic"] = "p95",
  ) {
    if (
      (statistic === "p95" &&
        (samplesMs.length !== samples || warmupMs.length !== warmups)) ||
      (statistic === "single" && samplesMs.length !== 1) ||
      [...warmupMs, ...samplesMs].some((n) => !Number.isFinite(n) || n < 0)
    ) {
      throw new Error("Benchmark sample set incomplete: " + name);
    }
    const observedMs = nearestRank(samplesMs, 0.95);
    result.measurements[name] = {
      budgetMs,
      observedMs,
      statistic,
      passed: observedMs <= budgetMs,
      warmupMs,
      samplesMs,
    };
    flush();
    console.log(
      name +
        " " +
        statistic +
        " " +
        observedMs.toFixed(1) +
        "ms (budget " +
        budgetMs +
        "ms)",
    );
  }
  function finish() {
    result.complete = true;
    phase("finished");
    return Object.entries(result.measurements)
      .filter(([, metric]) => !metric.passed)
      .map(([name]) => name);
  }
  flush();
  return { phase, record, observe, finish };
}

export type Evidence = ReturnType<typeof recorder>;

export async function series(
  evidence: Evidence,
  name: string,
  budget: number,
  run: (index: number) => Promise<number>,
) {
  evidence.phase(name);
  const times: number[] = [];
  for (let index = 0; index < warmups + samples; index++)
    times.push(await run(index));
  evidence.record(name, budget, times.slice(0, warmups), times.slice(warmups));
}

// Alternating the two inputs guarantees that each measured operation changes the
// requested projection. Keep each direction's 50-sample distribution independent.
export async function switches(
  evidence: Evidence,
  cases: { name: string; run: () => Promise<number> }[],
) {
  const times = cases.map(() => [] as number[]);
  for (let index = 0; index < warmups + samples; index++) {
    for (const [k, entry] of cases.entries()) {
      evidence.phase(entry.name + " " + (index + 1));
      times[k].push(await entry.run());
    }
  }
  for (const [k, entry] of cases.entries()) {
    evidence.record(
      entry.name,
      500,
      times[k].slice(0, warmups),
      times[k].slice(warmups),
    );
  }
}
