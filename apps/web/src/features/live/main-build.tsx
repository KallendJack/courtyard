import type {
  BuildJob,
  LiveStatus,
  LiveVersion,
  MainBuild,
  UpdateWaiting,
} from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { WebButton } from "@courtyard/ui/buttons/web-link.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { useFresh } from "@courtyard/ui/layout/kept.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { type ReactNode, useEffect, useState } from "react";
import { BuildGraph, BuildMiniGraph, OpenRow, useTicking } from "@/components/code/build-stages";
import { Sheet } from "@/components/sheets/sheet";
import type { FromWorker } from "../../api/worker.ts";
import { elapsedWords } from "../../lib/when.ts";
import { loadLive } from "./api.ts";

/**
 * How often a page showing main's build asks again while it runs (the worker asks GitHub), so
 * Update lights up moments after its last job passes (#337).
 */
export const MAIN_RUNNING_EVERY_MS = 10 * 1000;

/**
 * The live status, asked for once the page is showing and again when `again` changes (after a
 * merge), then kept fresh the shared way (#387): every 10 seconds while main's build runs, every
 * 30 while it's calm, nothing while the page is hidden, and at once when it's looked at again.
 * `when` false asks nothing.
 */
export const useLive = (when = true, again?: unknown) => {
  const [status, setStatus] = useState<FromWorker<LiveStatus>>();
  const running =
    status?.kind === "loaded" &&
    status.data.kind === "live" &&
    status.data.build?.kind === "running";

  // biome-ignore lint/correctness/useExhaustiveDependencies: asked again as `again` changes
  useEffect(() => {
    if (!when) return;
    let current = true;
    void loadLive().then((loaded) => {
      if (current) setStatus(loaded);
    });
    return () => {
      current = false;
    };
  }, [when, again]);

  useFresh({
    ask: async () => {
      const next = await loadLive();
      // A worker that didn't answer keeps what was shown, and is asked again.
      if (next.kind === "loaded") setStatus(next);
    },
    asking: when,
    busyEveryMs: running ? MAIN_RUNNING_EVERY_MS : undefined,
  });

  return [status, setStatus] as const;
};

/**
 * What Update can do now (#249, #186): offered once the newest main is newer than the live copy,
 * and while its build runs, when it waits for it (`waiting`); not offered once it has failed. With
 * no build to go by (GitHub can't be asked), it's offered, as it was before main's build showed.
 */
export const updateOffer = (live: LiveStatus | undefined) => {
  if (live?.kind !== "live" || !live.newerOnMain) return "none";
  switch (live.build?.kind) {
    case undefined:
    case "passed":
      return "ready";
    case "running":
      return "waiting";
    case "failed":
      return "failed";
  }
};

/** "Unit tests", or "Unit tests and 2 more". */
const namesSaid = (jobs: readonly BuildJob[]) => {
  const [first, ...more] = jobs;
  return `${first?.name ?? ""}${more.length === 0 ? "" : ` and ${more.length} more`}`;
};

/** How long until `endsAround`: "about 2 min left", or "nearly done" once it's past. */
const leftOf = (endsAround: string, now: number) => {
  const left = Date.parse(endsAround) - now;
  return left <= 0 ? "nearly done" : `about ${Math.ceil(left / 60_000)} min left`;
};

/**
 * Where the build stands, after its title (#337): "Running · 1:24", counting up, with how long
 * it has left when `full`; "Passed · 2:51"; "Unit tests failed · Update waits".
 */
const standing = (build: MainBuild, now: number, said: { full: boolean; updates: boolean }) => {
  switch (build.kind) {
    case "passed":
      return build.startedAt === null || build.completedAt === null
        ? "Passed"
        : `Passed · ${elapsedWords(Date.parse(build.completedAt) - Date.parse(build.startedAt))}`;
    case "failed": {
      const failed = build.stages.flat().filter((job) => job.outcome === "failed");
      return `${namesSaid(failed)} failed${said.updates ? " · Update waits" : ""}`;
    }
    case "running": {
      if (build.startedAt === null) return "Running";
      const running = `Running · ${elapsedWords(now - Date.parse(build.startedAt))}`;
      return said.full && build.endsAround !== null
        ? `${running} · ${leftOf(build.endsAround, now)}`
        : running;
    }
  }
};

const STANDING_LOOKS: Readonly<Record<MainBuild["kind"], string>> = {
  running: "text-primary-text",
  passed: "text-success",
  failed: "text-destructive",
};

/**
 * What a waiting Update waits for (#186; Paper, "Component · Update when ready: waits for a
 * check"), in place of where the build stands: main's build, then a check that's running (#629),
 * never sessions mid-turn (#621); or that it was dropped as main failed.
 */
export function Waiting(props: { waiting: UpdateWaiting }) {
  const { waiting } = props;
  switch (waiting.kind) {
    case "ci":
      return <span className="text-primary-text">Waiting for CI · updates when it passes</span>;
    case "check":
      return <span className="text-primary-text">Waiting for a check to finish</span>;
    case "dropped":
      return <span className="text-destructive">Main failed · Update dropped</span>;
  }
}

/** Update's taps (#186): Update, when ready; and while it waits, Update now and Cancel. */
export type UpdateTaps = {
  readonly onUpdate: () => void;
  readonly onUpdateNow: () => void;
  readonly onCancel: () => void;
};

/** The newest main's title and short commit: "7d518cd Rail and Talk key" reads "Rail and Talk key 7d518cd". */
export const titleOf = (newest: LiveVersion) => {
  const [commit = "", ...words] = newest.title.split(" ");
  return { commit, words: words.join(" ") };
};

/**
 * Update, offered whenever main is newer and hasn't failed (#186): tapped while its build runs,
 * it waits for it. While it waits, Cancel and Update now; Details once the build has failed.
 */
function Actions(props: {
  build: MainBuild;
  taps: UpdateTaps | undefined;
  waiting: UpdateWaiting | null;
  size: "md" | "lg";
}) {
  const { build, taps, waiting } = props;
  const details =
    waiting?.kind === "dropped"
      ? waiting.details
      : build.kind === "failed"
        ? build.details
        : undefined;
  if (details !== undefined) {
    return (
      <WebButton variant="outline" size={props.size} href={details}>
        Details
      </WebButton>
    );
  }
  if (taps === undefined) return null;
  if (waiting !== null) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <Button size={props.size} variant="quiet" onClick={taps.onCancel}>
          Cancel
        </Button>
        <Button size={props.size} variant="outline" onClick={taps.onUpdateNow}>
          Update now
        </Button>
      </span>
    );
  }
  return (
    <Button size={props.size} onClick={taps.onUpdate}>
      Update
    </Button>
  );
}

/** Where the build stands, or what a waiting Update waits for (#186). */
function Standing(props: {
  build: MainBuild;
  now: number;
  waiting: UpdateWaiting | null;
  full: boolean;
  updates: boolean;
  className?: string;
}): ReactNode {
  const { build, waiting } = props;
  return (
    <p
      role="status"
      className={classes(
        "text-meta font-semibold",
        waiting === null && STANDING_LOOKS[build.kind],
        props.className,
      )}
    >
      {waiting === null ? (
        standing(build, props.now, { full: props.full, updates: props.updates })
      ) : (
        <Waiting waiting={waiting} />
      )}
    </p>
  );
}

/**
 * Main's build in full (#337): its title and short commit, where it stands, and its graph, ending
 * in Update when there is one, or Details once it has failed.
 */
function FullBuild(props: {
  newest: LiveVersion;
  build: MainBuild;
  now: number;
  taps: UpdateTaps | undefined;
  waiting: UpdateWaiting | null;
}) {
  const { build, now, taps, waiting } = props;
  const { commit, words } = titleOf(props.newest);
  const updates = taps !== undefined;
  const actions = <Actions build={build} size="lg" taps={taps} waiting={waiting} />;
  // Beside the graph, Update alone; under it, Details, and Cancel with Update now.
  const under = build.kind === "failed" || waiting !== null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-interface font-bold wrap-anywhere">
          {words} · {commit}
        </p>
        <Standing build={build} now={now} waiting={waiting} full updates={updates} />
      </div>
      <BuildGraph
        stages={build.stages}
        now={now}
        {...(under || !updates ? {} : { end: actions })}
      />
      {under && <div className="flex justify-end">{actions}</div>}
    </div>
  );
}

/**
 * Main's build next to Update (#249), in stages (#337; Paper, "Component · Main's build as a
 * pipeline, live"): in full, its jobs drawn from the workflow's own order; or, as a row, one line
 * with a small graph that opens the full one. Update is offered once it has passed; quiet while it
 * runs; Details, its log on GitHub, once it has failed. Its times count up while it runs.
 */
export function MainBuildCard(props: {
  newest: LiveVersion;
  build: MainBuild;
  /** Update's taps, on the live copy; without them, the build alone (another repository's main, #301). */
  taps?: UpdateTaps;
  /** The Update waiting to run (#186), said in place of where the build stands. */
  waiting?: UpdateWaiting | null;
  /**
   * As a row, with a label in capitals before it that names it too ("Main" on a code workspace's
   * Home, #301; "New version" on Home, #102): its title, small graph and where it stands on one
   * line; a tap opens the full graph in a sheet.
   */
  label?: string;
  /**
   * As a row on a narrow screen (Home on the cover screen, #102; Paper, "Cover · Home"): the
   * label and the short commit as its title, and where the build stands for screen readers only.
   */
  short?: boolean;
}) {
  const { build, taps } = props;
  const waiting = props.waiting ?? null;
  const now = useTicking(build.kind === "running");
  const [open, setOpen] = useState(false);

  if (props.label === undefined) {
    return (
      <section aria-label="Updates" className="mt-4 rounded-card border bg-surface p-4">
        <FullBuild newest={props.newest} build={build} now={now} taps={taps} waiting={waiting} />
      </section>
    );
  }

  const short = props.short === true;
  const { commit, words } = titleOf(props.newest);
  const sheet = (
    <Sheet title="Main's build" open={open} onClose={() => setOpen(false)}>
      <FullBuild newest={props.newest} build={build} now={now} taps={taps} waiting={waiting} />
    </Sheet>
  );
  const title = (
    <OpenRow label="Main's build" onOpen={() => setOpen(true)}>
      <CapsLabel tone="muted" inline className={classes("shrink-0", short && "max-sm:hidden")}>
        {props.label}
      </CapsLabel>
      <span className="min-w-0 flex-1 truncate text-meta font-bold">
        {short && <span className="sm:hidden">{props.label} · </span>}
        <span className={short ? "max-sm:hidden" : undefined}>{words} </span>
        {commit}
      </span>
      <BuildMiniGraph stages={build.stages} />
    </OpenRow>
  );

  // While an Update waits (#186), what for goes under the title, where it has room; on the cover
  // screen, Cancel and Update now go under it too.
  if (waiting !== null) {
    return (
      <section
        aria-label={props.label}
        className={classes(
          "flex items-center gap-x-3.5 gap-y-2.5 rounded-bubble border bg-surface py-2.5 pr-2.5 pl-3.5",
          short && "max-sm:flex-col",
        )}
      >
        <div
          className={classes("flex min-w-0 flex-1 flex-col gap-1", short && "max-sm:self-stretch")}
        >
          {title}
          <Standing
            build={build}
            now={now}
            waiting={waiting}
            full={false}
            updates={false}
            className="truncate"
          />
        </div>
        <div
          className={classes("flex shrink-0", short && "max-sm:self-stretch max-sm:justify-end")}
        >
          <Actions build={build} size="md" taps={taps} waiting={waiting} />
        </div>
        {sheet}
      </section>
    );
  }
  return (
    <section
      aria-label={props.label}
      className="flex items-center gap-3.5 rounded-bubble border bg-surface py-2.5 pr-2.5 pl-3.5"
    >
      {title}
      <Standing
        build={build}
        now={now}
        waiting={waiting}
        full={false}
        updates={false}
        className={classes("shrink-0 tabular-nums", short && "max-sm:sr-only")}
      />
      <Actions build={build} size="md" taps={taps} waiting={waiting} />
      {sheet}
    </section>
  );
}
