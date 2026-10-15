import type { BuildJob, MainBuild } from "@courtyard/contract";
import type { FoundCheckRun, FoundWorkflow } from "./api.ts";
import { type WorkflowJob, workflowJobs } from "./workflow.ts";

/**
 * Main's build in stages (#337), from the latest try of each job on the commit and the workflows
 * that ran there: each workflow's jobs in the order its file lists them, a job that `needs:`
 * others in the stage after theirs, and a matrix job's runs folded into one row. A check that no
 * workflow names (another app's) is a row of its own in the first stage. With no workflow to go
 * by, every check is its own row, in one stage, in the order GitHub made them.
 */

/** How many of a job's latest passing runs say how long it usually takes. */
const TYPICAL_RUNS = 5;

/** A row of main's build: a workflow's job and its runs on the commit. */
type Row = {
  readonly name: string;
  readonly needs: readonly string[];
  readonly stage: number;
  /** Whether a check run, by its name, is a run of this job. */
  readonly matches: (run: string) => boolean;
  /** It folds a matrix's runs. */
  readonly folds: boolean;
  readonly runs: FoundCheckRun[];
};

const EXPRESSION = /\$\{\{.*?\}\}/;
const hasExpression = (text: string) => EXPRESSION.test(text);
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * How GitHub names a job's check runs: its name with each expression filled in, or with the
 * matrix's values after it in brackets when its name has none.
 */
const matcherOf = (job: WorkflowJob) => {
  const shown = job.name ?? job.id;
  if (hasExpression(shown)) {
    const pattern = new RegExp(`^${shown.split(EXPRESSION).map(escaped).join(".+?")}$`);
    return (run: string) => pattern.test(run);
  }
  if (job.matrix) {
    const pattern = new RegExp(`^${escaped(shown)}( \\(.+\\))?$`);
    return (run: string) => pattern.test(run);
  }
  return (run: string) => run === shown;
};

/** A job's row's name: "E2E ${{ matrix.shard }}/4" is "E2E"; one with no name, its id. */
const rowNameOf = (job: WorkflowJob) => {
  const shown = job.name ?? job.id;
  const [before = ""] = shown.split("${{");
  const name = before.replace(/[^\p{L}\p{N}]+$/u, "");
  return name === "" ? job.id : name;
};

/** Each workflow's jobs as rows, with no runs yet, a job after the ones it needs. */
const rowsOf = (workflows: readonly FoundWorkflow[]) =>
  [...workflows]
    .sort((a, b) => a.path.localeCompare(b.path))
    .flatMap((workflow) => {
      const jobs = workflowJobs(workflow.text);
      const byId = new Map(jobs.map((job) => [job.id, job]));
      const stages = new Map<string, number>();
      const stageOf = (job: WorkflowJob, seen: ReadonlySet<string>): number => {
        const known = stages.get(job.id);
        if (known !== undefined) return known;
        const needed = job.needs.flatMap((id) => {
          const need = byId.get(id);
          // A job that needs itself, round about, is as if it needed nothing more.
          return need === undefined || seen.has(id) ? [] : [stageOf(need, new Set([...seen, id]))];
        });
        const stage = needed.length === 0 ? 0 : Math.max(...needed) + 1;
        stages.set(job.id, stage);
        return stage;
      };
      return jobs.map(
        (job): Row => ({
          name: rowNameOf(job),
          needs: job.needs.flatMap((id) => {
            const need = byId.get(id);
            return need === undefined ? [] : [rowNameOf(need)];
          }),
          stage: stageOf(job, new Set([job.id])),
          matches: matcherOf(job),
          folds: job.matrix || hasExpression(job.name ?? ""),
          runs: [],
        }),
      );
    });

const timeOf = (when: string | null) => {
  const at = Date.parse(when ?? "");
  return Number.isFinite(at) ? at : undefined;
};
const iso = (at: number | undefined) => (at === undefined ? null : new Date(at).toISOString());
const earliest = (times: readonly (number | undefined)[]) => {
  const known = times.filter((at) => at !== undefined);
  return known.length === 0 ? undefined : Math.min(...known);
};

/** A row as main's build shows it. */
const jobOf = (row: Row, workflowsDone: boolean): BuildJob => {
  const { runs } = row;
  const finished = runs.filter((run) => run.outcome !== "running");
  const ends = finished.map((run) => timeOf(run.completedAt));
  const outcome: BuildJob["outcome"] =
    runs.length === 0
      ? workflowsDone
        ? "other"
        : "waiting"
      : runs.some((run) => run.outcome === "failed")
        ? "failed"
        : runs.some((run) => run.outcome === "running")
          ? "running"
          : runs.every((run) => run.outcome === "passed")
            ? "passed"
            : "other";
  return {
    name: row.name,
    outcome,
    startedAt: iso(earliest(runs.map((run) => timeOf(run.startedAt)))),
    completedAt:
      runs.length > 0 && finished.length === runs.length && ends.every((at) => at !== undefined)
        ? iso(Math.max(...ends))
        : null,
    shards: row.folds ? { done: finished.length, total: runs.length } : null,
    needs: [...row.needs],
  };
};

/** The middle of some lengths. */
const median = (lengths: readonly number[]) => {
  const sorted = [...lengths].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const [low = 0, high = 0] = [sorted[middle - 1], sorted[middle]];
  return sorted.length % 2 === 1 ? high : (low + high) / 2;
};

/**
 * How long each job usually takes, by its check run's name (a matrix's runs each their own): the
 * middle of its latest passing runs on earlier builds, each run's own start to its own end, so a
 * job run again later, or a build that waited its turn, changes nothing. `earlier` newest first.
 */
export const typicalLengths = (earlier: readonly (readonly FoundCheckRun[])[]) => {
  const lengths = new Map<string, number[]>();
  for (const runs of earlier) {
    for (const run of runs) {
      const took = (timeOf(run.completedAt) ?? Number.NaN) - (timeOf(run.startedAt) ?? Number.NaN);
      if (run.outcome !== "passed" || !(took > 0)) continue;
      const known = lengths.get(run.name) ?? [];
      if (known.length < TYPICAL_RUNS) lengths.set(run.name, [...known, took]);
    }
  }
  return new Map([...lengths].map(([name, took]) => [name, median(took)]));
};

/**
 * When the build should end: each job ends its usual length after it started, or after the jobs
 * it needs end; one already past its usual length ends now. `undefined` when a job still to end
 * has no usual length.
 */
const endsAroundOf = (rows: readonly Row[], typical: ReadonlyMap<string, number>, now: number) => {
  const byName = new Map(rows.map((row) => [row.name, row]));
  const ends = new Map<Row, number | undefined>();
  const endOf = (row: Row, seen: ReadonlySet<Row>): number | undefined => {
    if (ends.has(row)) return ends.get(row);
    const needed = row.needs.flatMap((name) => {
      const need = byName.get(name);
      return need === undefined || seen.has(need) ? [] : [endOf(need, new Set([...seen, need]))];
    });
    const ready = needed.includes(undefined)
      ? undefined
      : Math.max(now, ...needed.filter((at) => at !== undefined));
    const lengthOf = (names: readonly string[]) => {
      const known = names.flatMap((name) => {
        const length = typical.get(name);
        return length === undefined ? [] : [length];
      });
      return known.length === 0 ? undefined : Math.max(...known);
    };
    let end: number | undefined;
    if (row.runs.length === 0) {
      const length = lengthOf([...typical.keys()].filter(row.matches));
      end = ready === undefined || length === undefined ? undefined : ready + length;
    } else {
      const each = row.runs.map((run) => {
        if (run.outcome !== "running") return timeOf(run.completedAt) ?? now;
        const length = typical.get(run.name);
        const started = timeOf(run.startedAt) ?? ready;
        return length === undefined || started === undefined ? undefined : started + length;
      });
      end = each.includes(undefined)
        ? undefined
        : Math.max(...each.filter((at) => at !== undefined));
    }
    ends.set(row, end);
    return end;
  };
  const all = rows.map((row) => endOf(row, new Set([row])));
  return all.includes(undefined) ? undefined : Math.max(...all.filter((at) => at !== undefined));
};

export const mainBuildOf = (of: {
  /** The latest try of each job on the commit, in the order GitHub made them. */
  runs: readonly FoundCheckRun[];
  workflows: readonly FoundWorkflow[];
  /** How long each job usually takes, by its check run's name. */
  typical: ReadonlyMap<string, number>;
  now: number;
}): MainBuild => {
  const rows = rowsOf(of.workflows);
  for (const run of of.runs) {
    const row = rows.find((each) => each.matches(run.name));
    if (row !== undefined) row.runs.push(run);
    else {
      rows.push({
        name: run.name,
        needs: [],
        stage: 0,
        matches: (name) => name === run.name,
        folds: false,
        runs: [run],
      });
    }
  }
  const workflowsDone = of.workflows.length > 0 && of.workflows.every((each) => each.done);
  const ordered = rows
    .map((row, at) => ({ row, at }))
    .sort((a, b) => a.row.stage - b.row.stage || a.at - b.at)
    .map(({ row }) => row);
  const stages: BuildJob[][] = [];
  for (const row of ordered) {
    const stage = stages[row.stage] ?? [];
    stages[row.stage] = stage;
    stage.push(jobOf(row, workflowsDone));
  }
  const filled = stages.filter((stage) => stage !== undefined);
  const jobs = filled.flat();

  const failed = ordered.flatMap((row) => row.runs).find((run) => run.outcome === "failed");
  if (failed !== undefined) return { kind: "failed", stages: filled, details: failed.url };
  const workflowStarts = of.workflows.map((each) => timeOf(each.startedAt));
  const startedAt = iso(
    workflowStarts.length > 0 && !workflowStarts.includes(undefined)
      ? earliest(workflowStarts)
      : earliest(jobs.map((job) => timeOf(job.startedAt))),
  );
  if (
    jobs.length > 0 &&
    jobs.every((job) => job.outcome !== "running" && job.outcome !== "waiting")
  ) {
    const ends = jobs.map((job) => timeOf(job.completedAt));
    return {
      kind: "passed",
      stages: filled,
      startedAt,
      completedAt: ends.includes(undefined)
        ? null
        : iso(Math.max(...ends.filter((at) => at !== undefined))),
    };
  }
  return {
    kind: "running",
    stages: filled,
    startedAt,
    endsAround: jobs.length === 0 ? null : iso(endsAroundOf(ordered, of.typical, of.now)),
  };
};
