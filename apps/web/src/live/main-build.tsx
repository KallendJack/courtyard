import type { BuildJob, LiveStatus, LiveVersion, MainBuild } from "@courtyard/contract";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { WebButton } from "@/components/web-link";
import { classes } from "@/lib/classes";
import type { FromWorker } from "../worker.ts";
import { loadLive } from "./api.ts";

/** How often a page showing main's build asks again while it runs (the worker asks GitHub). */
const ASK_EVERY_MS = 15 * 1000;

/**
 * The live status, asked for once the page is showing, then again every 15 seconds while main's
 * build runs and the page is in front of the owner: hidden, it waits, and asks as soon as it's
 * looked at again. `when` false asks nothing.
 */
export const useLive = (when = true) => {
  const [status, setStatus] = useState<FromWorker<LiveStatus>>();
  const running =
    status?.kind === "loaded" &&
    status.data.kind === "live" &&
    status.data.build?.kind === "running";

  useEffect(() => {
    if (!when) return;
    let current = true;
    void loadLive().then((loaded) => {
      if (current) setStatus(loaded);
    });
    return () => {
      current = false;
    };
  }, [when]);

  useEffect(() => {
    if (!running) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** Hidden when it was time to ask: it asks once the page is looked at. */
    let waiting = false;
    const ask = async () => {
      if (document.visibilityState === "hidden") {
        waiting = true;
        return;
      }
      const next = await loadLive();
      if (!current) return;
      // A worker that didn't answer keeps what was shown, and is asked again.
      if (next.kind === "loaded") setStatus(next);
      timer = setTimeout(ask, ASK_EVERY_MS);
    };
    const shown = () => {
      if (!waiting || document.visibilityState === "hidden") return;
      waiting = false;
      void ask();
    };
    timer = setTimeout(ask, ASK_EVERY_MS);
    document.addEventListener("visibilitychange", shown);
    return () => {
      current = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", shown);
    };
  }, [running]);

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

/** Each job's bar and name, by how it's going: violet running, moss passed, red failed. */
const LOOKS: Readonly<Record<BuildJob["outcome"], { bar: string; name: string; said: string }>> = {
  running: { bar: "bg-primary shadow-glow", name: "text-primary-text", said: "running" },
  passed: { bar: "bg-success", name: "text-placeholder", said: "passed" },
  failed: { bar: "bg-destructive", name: "text-destructive", said: "failed" },
  other: { bar: "bg-input", name: "text-placeholder", said: "didn't run" },
};

/** "Unit tests", or "Unit tests and 2 more". */
const namesSaid = (jobs: readonly BuildJob[]) => {
  const [first, ...more] = jobs;
  return `${first?.name ?? ""}${more.length === 0 ? "" : ` and ${more.length} more`}`;
};

/** Where the build stands, after its title: "Unit tests · about 2 min". */
const standing = (build: MainBuild, updates: boolean) => {
  switch (build.kind) {
    case "passed":
      return updates ? "Passed · ready to update" : "Passed";
    case "failed":
      return `${namesSaid(build.jobs.filter((job) => job.outcome === "failed"))} failed${updates ? " · Update waits" : ""}`;
    case "running": {
      const running = build.jobs.filter((job) => job.outcome === "running");
      const what = running.length === 1 && running[0] ? running[0].name : "Running";
      if (build.endsAround === null) return what;
      const minutes = Math.max(1, Math.ceil((Date.parse(build.endsAround) - Date.now()) / 60_000));
      return `${what} · about ${minutes} min`;
    }
  }
};

const STANDING_LOOKS: Readonly<Record<MainBuild["kind"], string>> = {
  running: "text-primary-text",
  passed: "text-success",
  failed: "text-destructive",
};

/**
 * Main's build next to Update (#249; Paper, "Main build bar and Update"): the newest main's title
 * and short commit, one bar per CI job joined with small gaps, each job's name under its bar, and
 * Update, offered once it has passed; quiet while it runs; Details, its log on GitHub, once it
 * has failed.
 */
export function MainBuildCard(props: {
  newest: LiveVersion;
  build: MainBuild;
  /** Update, on the live copy; without it, the bar alone (another repository's main, #301). */
  onUpdate?: () => void;
  /**
   * As a row, with a label in capitals before it that names it too ("Main" on a code workspace's
   * Home, #301; Paper, "Code workspace Home"): its title on one line, its bars thin, and each job's
   * name for screen readers only.
   */
  label?: string;
}) {
  const { build } = props;
  const row = props.label !== undefined;
  // "7d518cd Rail and Talk key" reads as "Rail and Talk key 7d518cd".
  const [commit = "", ...words] = props.newest.title.split(" ");
  return (
    <section
      aria-label={props.label ?? "Updates"}
      className={classes(
        "flex flex-wrap items-center border bg-surface",
        row
          ? "gap-3.5 rounded-bubble py-2.5 pr-2.5 pl-3.5"
          : "mt-4 gap-4 rounded-card py-4 pr-4 pl-4.5",
      )}
    >
      {props.label !== undefined && (
        <span className="shrink-0 text-label font-bold tracking-label text-muted-foreground uppercase">
          {props.label}
        </span>
      )}
      <div className={classes("flex min-w-60 flex-1 flex-col", row ? "gap-1.5" : "gap-2.5")}>
        <div className="flex justify-between gap-3">
          <p
            className={classes(
              "min-w-0 wrap-anywhere",
              row ? "truncate text-label font-bold" : "text-interface font-semibold",
            )}
          >
            {words.join(" ")} {commit}
          </p>
          <p
            role="status"
            className={classes("shrink-0 text-label font-semibold", STANDING_LOOKS[build.kind])}
          >
            {standing(build, props.onUpdate !== undefined)}
          </p>
        </div>
        <ol aria-label="Main's build" className="flex gap-1">
          {build.jobs.map((job) => (
            <li key={job.name} className="flex min-w-0 flex-1 flex-col gap-2.5">
              <span
                aria-hidden
                className={classes(
                  row ? "h-1.5 rounded-full" : "h-2 rounded-sm",
                  LOOKS[job.outcome].bar,
                )}
              />
              <span
                className={classes(
                  row ? "sr-only" : "truncate text-caption font-semibold",
                  LOOKS[job.outcome].name,
                )}
              >
                {job.name}
                <span className="sr-only">: {LOOKS[job.outcome].said}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      {build.kind === "failed" ? (
        <WebButton variant="outline" size={row ? "md" : "lg"} href={build.details}>
          Details
        </WebButton>
      ) : (
        props.onUpdate !== undefined && (
          <Button
            size={row ? "md" : "lg"}
            variant={build.kind === "running" ? "outline" : "primary"}
            disabled={build.kind === "running"}
            onClick={props.onUpdate}
          >
            Update
          </Button>
        )
      )}
    </section>
  );
}
