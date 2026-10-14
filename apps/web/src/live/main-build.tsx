import type { BuildJob, LiveStatus, LiveVersion, MainBuild } from "@courtyard/contract";
import { useEffect, useState } from "react";
import { BuildGraph, BuildMiniGraph, OpenRow, useTicking } from "@/components/build-stages";
import { Button } from "@/components/button";
import { useFresh } from "@/components/kept";
import { Sheet } from "@/components/sheet";
import { WebButton } from "@/components/web-link";
import { classes } from "@/lib/classes";
import { elapsedWords } from "../when.ts";
import type { FromWorker } from "../worker.ts";
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
 * What Update can do now (#249): offered only once the newest main has passed and is newer than
 * the live copy; waiting while its build runs; not offered once it has failed. With no build to
 * go by (GitHub can't be asked), it's offered, as it was before main's build showed.
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

/** The newest main's title and short commit: "7d518cd Rail and Talk key" reads "Rail and Talk key 7d518cd". */
export const titleOf = (newest: LiveVersion) => {
  const [commit = "", ...words] = newest.title.split(" ");
  return { commit, words: words.join(" ") };
};

/** Update, offered once the build has passed; quiet while it runs; Details once it has failed. */
function Actions(props: { build: MainBuild; onUpdate?: () => void; size: "md" | "lg" }) {
  const { build } = props;
  if (build.kind === "failed") {
    return (
      <WebButton variant="outline" size={props.size} href={build.details}>
        Details
      </WebButton>
    );
  }
  return (
    props.onUpdate !== undefined && (
      <Button
        size={props.size}
        variant={build.kind === "running" ? "outline" : "primary"}
        disabled={build.kind === "running"}
        onClick={props.onUpdate}
      >
        Update
      </Button>
    )
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
  onUpdate?: () => void;
}) {
  const { build, now } = props;
  const { commit, words } = titleOf(props.newest);
  const updates = props.onUpdate !== undefined;
  const actions = (
    <Actions build={build} size="lg" {...(updates ? { onUpdate: props.onUpdate } : {})} />
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-interface font-bold wrap-anywhere">
          {words} · {commit}
        </p>
        <p
          role="status"
          className={classes("text-label font-semibold", STANDING_LOOKS[build.kind])}
        >
          {standing(build, now, { full: true, updates })}
        </p>
      </div>
      <BuildGraph
        stages={build.stages}
        now={now}
        {...(build.kind === "failed" || !updates ? {} : { end: actions })}
      />
      {build.kind === "failed" && <div className="flex justify-end">{actions}</div>}
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
  /** Update, on the live copy; without it, the build alone (another repository's main, #301). */
  onUpdate?: () => void;
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
  const { build } = props;
  const now = useTicking(build.kind === "running");
  const [open, setOpen] = useState(false);
  const updates = props.onUpdate === undefined ? {} : { onUpdate: props.onUpdate };

  if (props.label === undefined) {
    return (
      <section aria-label="Updates" className="mt-4 rounded-card border bg-surface p-4">
        <FullBuild newest={props.newest} build={build} now={now} {...updates} />
      </section>
    );
  }

  const short = props.short === true;
  const { commit, words } = titleOf(props.newest);
  return (
    <section
      aria-label={props.label}
      className="flex items-center gap-3.5 rounded-bubble border bg-surface py-2.5 pr-2.5 pl-3.5"
    >
      <OpenRow label="Main's build" onOpen={() => setOpen(true)}>
        <span
          className={classes(
            "shrink-0 text-label font-bold tracking-label text-muted-foreground uppercase",
            short && "max-sm:hidden",
          )}
        >
          {props.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-label font-bold">
          {short && <span className="sm:hidden">{props.label} · </span>}
          <span className={short ? "max-sm:hidden" : undefined}>{words} </span>
          {commit}
        </span>
        <BuildMiniGraph stages={build.stages} />
      </OpenRow>
      <p
        role="status"
        className={classes(
          "shrink-0 text-label font-semibold tabular-nums",
          STANDING_LOOKS[build.kind],
          short && "max-sm:sr-only",
        )}
      >
        {standing(build, now, { full: false, updates: false })}
      </p>
      <Actions build={build} size="md" {...updates} />
      <Sheet title="Main's build" open={open} onClose={() => setOpen(false)}>
        <FullBuild newest={props.newest} build={build} now={now} {...updates} />
      </Sheet>
    </section>
  );
}
