import type { BuildJob } from "@courtyard/contract";
import { Check, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { classes } from "@/lib/classes";
import { elapsedWords } from "../lib/when.ts";
import { Scroller } from "./scroller.tsx";

// A CI build in stages (#337; Paper, "Component · Main's build as a pipeline, live"): jobs that
// start together stacked in one column, a job that waits on others after them, joined by lines
// that fill moss as the job before passes. Main's build card (live/main-build.tsx) shows it in
// full, or as a small graph in a row that opens the full one.

/** The time now, ticking every second while `ticking`, so a build's times count up. */
export const useTicking = (ticking: boolean) => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
};

/** How long a job has run, or ran: counting up while it runs; nothing while it waits. */
const timeOf = (job: BuildJob, now: number) => {
  if (job.startedAt === null) return "";
  const end = job.completedAt === null ? now : Date.parse(job.completedAt);
  return elapsedWords(end - Date.parse(job.startedAt));
};

/** What a job's row says of it after its name: "1 of 4 · 1:24", "0:26". */
const sideOf = (job: BuildJob, now: number) => {
  const time = timeOf(job, now);
  const done = job.outcome === "passed" || job.outcome === "other";
  const count = job.shards === null || done ? "" : `${job.shards.done} of ${job.shards.total}`;
  return [count, time].filter((part) => part !== "").join(" · ");
};

/** How each job's dot, row and time look, and how screen readers say it's going. */
const LOOKS: Readonly<
  Record<BuildJob["outcome"], { row: string; time: string; line: string; said: string }>
> = {
  running: {
    row: "bg-secondary",
    time: "text-primary-text",
    line: "stroke-input",
    said: "running",
  },
  passed: { row: "bg-secondary", time: "text-success", line: "stroke-success", said: "passed" },
  failed: { row: "bg-secondary", time: "text-destructive", line: "stroke-input", said: "failed" },
  waiting: {
    row: "border border-dashed border-input text-placeholder",
    time: "text-placeholder",
    line: "stroke-input",
    said: "waiting",
  },
  other: {
    row: "bg-secondary text-placeholder",
    time: "text-placeholder",
    line: "stroke-input",
    said: "didn't run",
  },
};

/** A job's dot: a spinning violet ring running, a moss tick passed, a red cross failed, grey otherwise. */
function Dot(props: { outcome: BuildJob["outcome"] }) {
  switch (props.outcome) {
    case "running":
      return (
        <span
          aria-hidden
          className="size-5 shrink-0 animate-spin rounded-full border-2 border-primary/30 border-t-primary"
        />
      );
    case "passed":
      return (
        <span
          aria-hidden
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success text-card"
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
      );
    case "failed":
      return (
        <span
          aria-hidden
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive text-card"
        >
          <X className="size-3" strokeWidth={3} />
        </span>
      );
    default:
      return <span aria-hidden className="size-5 shrink-0 rounded-full border-2 border-input" />;
  }
}

/** A row's height and the gap between rows, in pixels, as the classes below draw them. */
const ROW = 36;
const GAP = 8;
/** How wide the lines between two stages are. */
const JOIN = 48;

const heightOf = (rows: number) => rows * ROW + Math.max(0, rows - 1) * GAP;
/** The middle of row `at` of `rows`, in a column `height` tall with its rows in its middle. */
const middleOf = (at: number, rows: number, height: number) =>
  (height - heightOf(rows)) / 2 + at * (ROW + GAP) + ROW / 2;

/** A curve from one row's right edge to another's left, `width` apart. */
const curve = (from: number, to: number, width: number) =>
  `M0 ${from} C${width / 2} ${from} ${width / 2} ${to} ${width} ${to}`;

/** The lines between two stages: from each job to each job after it that needs it. */
function Joins(props: {
  from: readonly BuildJob[];
  to: readonly BuildJob[] | "end";
  height: number;
}) {
  const { from, to, height } = props;
  const lines = from.flatMap((job, at) => {
    const start = middleOf(at, from.length, height);
    if (to === "end") return [{ key: job.name, job, start, end: height / 2, waits: false }];
    return to.flatMap((next, nextAt) =>
      next.needs.includes(job.name)
        ? [
            {
              key: `${job.name}→${next.name}`,
              job,
              start,
              end: middleOf(nextAt, to.length, height),
              waits: next.outcome === "waiting",
            },
          ]
        : [],
    );
  });
  return (
    <svg aria-hidden width={JOIN} height={height} className="shrink-0 fill-none">
      {lines.map((line) => (
        <path
          key={line.key}
          d={curve(line.start, line.end, JOIN)}
          strokeWidth={2}
          strokeDasharray={line.waits ? "4 4" : undefined}
          className={LOOKS[line.job.outcome].line}
        />
      ))}
    </svg>
  );
}

/**
 * The full graph: each stage a column of jobs, joined by lines to the jobs that need them, and to
 * `end` (Update) after the last stage when there is one. Each job's dot, name and time, its time
 * counting up while it runs; a matrix job's count of runs finished while it runs.
 */
export function BuildGraph(props: {
  stages: readonly (readonly BuildJob[])[];
  now: number;
  end?: ReactNode;
}) {
  const { stages, now } = props;
  const height = heightOf(Math.max(1, ...stages.map((stage) => stage.length)));
  const last = stages.at(-1);
  return (
    // Its rows narrower where it has little room (Settings), so Update stays in sight.
    <Scroller axis="x" className="@container -mx-1 px-1">
      {/* biome-ignore lint/a11y/useSemanticElements: one list of every job, stage by stage, for screen readers, while each stage's column (no list item itself) draws them: an <ol> can't hold the columns. */}
      <div role="list" aria-label="Main's build" className="flex w-max items-center">
        {stages.map((stage, at) => (
          <div role="none" key={stage.map((job) => job.name).join()} className="flex items-center">
            {at > 0 && <Joins from={stages[at - 1] ?? []} to={stage} height={height} />}
            <div role="none" className="flex w-40 flex-col gap-2 @xl:w-60">
              {stage.map((job) => (
                // biome-ignore lint/a11y/useSemanticElements: an item of the list above, inside its stage's column.
                <div
                  role="listitem"
                  key={job.name}
                  className={classes(
                    "flex h-9 items-center gap-2.5 rounded-row px-3",
                    LOOKS[job.outcome].row,
                  )}
                >
                  <Dot outcome={job.outcome} />
                  <span className="min-w-0 flex-1 truncate text-meta font-semibold">
                    {job.name}
                    <span className="sr-only">: {LOOKS[job.outcome].said}</span>
                  </span>
                  <span
                    className={classes(
                      "shrink-0 text-meta font-semibold tabular-nums",
                      LOOKS[job.outcome].time,
                    )}
                  >
                    {sideOf(job, now)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {props.end !== undefined && last !== undefined && (
          <div role="none" className="flex items-center">
            <Joins from={last} to="end" height={height} />
            {props.end}
          </div>
        )}
      </div>
    </Scroller>
  );
}

/** A small graph's dot: how far apart they are, their size, and how wide a stage is. */
const MINI_PITCH = 8;
const MINI_DOT = 3;
const MINI_STAGE = 20;
const MINI_HEIGHT = 28;
/** At most this many dots in a small graph's column. */
const MINI_ROWS = 3;

const MINI_DOTS: Readonly<Record<BuildJob["outcome"], string>> = {
  running: "fill-card stroke-primary",
  passed: "fill-success stroke-success",
  failed: "fill-destructive stroke-destructive",
  waiting: "fill-card stroke-input",
  other: "fill-input stroke-input",
};

/**
 * The small graph in main's build's row: a dot for each job, stacked where jobs run side by side
 * and joined where one waits on another, all leading to a last dot, its end.
 */
export function BuildMiniGraph(props: { stages: readonly (readonly BuildJob[])[] }) {
  const stages = props.stages.map((stage) => stage.slice(0, MINI_ROWS));
  const width = stages.length * MINI_STAGE + MINI_DOT * 2 + 2;
  const xOf = (at: number) => MINI_DOT + 1 + at * MINI_STAGE;
  const yOf = (at: number, rows: number) => MINI_HEIGHT / 2 + (at - (rows - 1) / 2) * MINI_PITCH;
  const end = { x: xOf(stages.length), y: MINI_HEIGHT / 2 };
  return (
    <svg aria-hidden width={width} height={MINI_HEIGHT} className="shrink-0 fill-none">
      {stages.flatMap((stage, at) =>
        stage.flatMap((job, row) => {
          const next = stages[at + 1];
          const from = { x: xOf(at), y: yOf(row, stage.length) };
          const targets =
            next === undefined
              ? [{ key: "end", ...end, waits: false }]
              : next.flatMap((after, afterRow) =>
                  after.needs.includes(job.name)
                    ? [
                        {
                          key: after.name,
                          x: xOf(at + 1),
                          y: yOf(afterRow, next.length),
                          waits: after.outcome === "waiting",
                        },
                      ]
                    : [],
                );
          return targets.map((to) => (
            <path
              key={`${job.name}→${to.key}`}
              d={`M${from.x} ${from.y} C${(from.x + to.x) / 2} ${from.y} ${(from.x + to.x) / 2} ${to.y} ${to.x} ${to.y}`}
              strokeWidth={1.5}
              strokeDasharray={to.waits ? "2 2" : undefined}
              className={LOOKS[job.outcome].line}
            />
          ));
        }),
      )}
      {stages.flatMap((stage, at) =>
        stage.map((job, row) => (
          <circle
            key={job.name}
            cx={xOf(at)}
            cy={yOf(row, stage.length)}
            r={MINI_DOT}
            strokeWidth={1.5}
            strokeDasharray={job.outcome === "waiting" ? "2 1.5" : undefined}
            className={MINI_DOTS[job.outcome]}
          />
        )),
      )}
      <circle cx={end.x} cy={end.y} r={MINI_DOT} className="fill-input" />
    </svg>
  );
}

/**
 * A row that opens what it names when tapped (main's build's row, which opens its full graph):
 * everything but the actions beside it, which stay their own buttons.
 */
export function OpenRow(props: { label: string; onOpen: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={props.label}
      onClick={props.onOpen}
      className="flex min-w-0 flex-1 items-center gap-3.5 rounded-row text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {props.children}
    </button>
  );
}
