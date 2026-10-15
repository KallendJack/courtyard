import type { LiveUpdateResult, LiveVersion } from "@courtyard/contract";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/buttons/button";
import { FormError } from "@/components/forms/form-error";
import { CapsLabel } from "@/components/layout/caps-label";
import { PlaceholderRows } from "@/components/layout/kept";
import { InfoBox } from "@/components/layout/notice";
import { describeProblem } from "../../components/layout/problems.tsx";
import { cancelLiveUpdate, loadLive, startLiveUpdate } from "./api.ts";
import { MainBuildCard, titleOf, type UpdateTaps, useLive, Waiting } from "./main-build.tsx";

/** How often the page asks how an update is going. The worker is down for part of it. */
const FOLLOW_EVERY_MS = 3000;
/** Past this, the page stops waiting and says so. An update takes a minute or two. */
const FOLLOW_FOR_MS = 10 * 60 * 1000;
/** How long the last update's result stays on Home. */
const SHOW_RESULT_FOR_MS = 60 * 60 * 1000;

type Following =
  | { readonly kind: "idle" }
  /** Started, waiting for a result newer than the one there was before. */
  | { readonly kind: "updating"; readonly since: string | null; readonly at: number }
  | { readonly kind: "done"; readonly result: LiveUpdateResult }
  | { readonly kind: "lost" }
  | { readonly kind: "problem"; readonly message: string };

const isRecent = (result: LiveUpdateResult) =>
  result.finishedAt !== null && Date.now() - Date.parse(result.finishedAt) < SHOW_RESULT_FOR_MS;

/** How the update went. Reload only where this page followed it, so is still the old version. */
function Result(props: { result: LiveUpdateResult; offerReload: boolean }) {
  return (
    <>
      <span>{props.result.message}</span>
      {props.offerReload && props.result.outcome === "updated" && (
        <Button size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
      )}
    </>
  );
}

/**
 * Updating the live app from the app (ADR 0011): when main has moved on, main's build beside
 * Update (#249), which waits for it to pass; then how the update went once the worker is back.
 * Nothing at all on a worker that isn't a live copy. Asked for once the page is showing, since the
 * worker may be asking GitHub whether main has moved on: the page never waits for that. On Home
 * (#102), main's build is a row, labelled `label` ("New version"), `short` on a narrow screen;
 * `keepsPlace` keeps its row there while there's nothing to update, as a quiet Up to date line,
 * and its place while it's still to come (#283).
 */
export function LiveUpdate(props: { label?: string; short?: boolean; keepsPlace?: boolean }) {
  const [status, setStatus] = useLive();
  const [following, setFollowing] = useState<Following>({ kind: "idle" });
  const loaded = status?.kind === "loaded" ? status.data : undefined;
  // Started from another device, or before this page was opened.
  const updating = loaded?.kind === "live" && loaded.lastUpdate?.outcome === "running";

  useEffect(() => {
    if (!updating) return;
    setFollowing((was) =>
      was.kind === "idle" ? { kind: "updating", since: null, at: Date.now() } : was,
    );
  }, [updating]);

  useEffect(() => {
    if (following.kind !== "updating") return;
    // One question at a time: the next is asked only after the last one's answer.
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const ask = async () => {
      if (Date.now() - following.at > FOLLOW_FOR_MS) return setFollowing({ kind: "lost" });
      const next = await loadLive();
      if (!current) return;
      // While the worker restarts it doesn't answer; the page just asks again.
      if (next.kind === "loaded" && next.data.kind === "live") {
        setStatus(next);
        const last = next.data.lastUpdate;
        if (last && last.finishedAt !== null && last.startedAt !== following.since) {
          return setFollowing({ kind: "done", result: last });
        }
      }
      timer = setTimeout(ask, FOLLOW_EVERY_MS);
    };
    timer = setTimeout(ask, FOLLOW_EVERY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [following, setStatus]);

  if (status === undefined && props.keepsPlace) return <PlaceholderRows count={1} size="bar" />;
  if (status?.kind !== "loaded" || status.data.kind !== "live") return null;
  const live = status.data;

  /** The status again, at once, so what's waiting shows (#186). */
  const reload = async () => {
    const next = await loadLive();
    if (next.kind === "loaded") setStatus(next);
  };
  /**
   * Update (#186): at once, when it can run, and this page follows it; else it waits, and the
   * row says what for. `now` runs it at once whatever it waits for.
   */
  const update = async (now: boolean) => {
    const since = live.lastUpdate?.startedAt ?? null;
    const started = await startLiveUpdate(now);
    if (started.kind === "loaded" && started.data.waits) return reload();
    // Already running (started on another device, say): this page follows that one.
    const alreadyRunning = started.kind === "failed" && started.status === 409;
    setFollowing(
      started.kind === "loaded" || alreadyRunning
        ? { kind: "updating", since, at: Date.now() }
        : { kind: "problem", message: describeProblem(started).body },
    );
  };
  const taps: UpdateTaps = {
    onUpdate: () => void update(false),
    onUpdateNow: () => void update(true),
    onCancel: () => {
      void cancelLiveUpdate().then(reload);
    },
  };

  let content: ReactNode = null;
  if (following.kind === "updating") {
    content = <span>Updating. Courtyard restarts, and this page carries on by itself.</span>;
  } else if (following.kind === "done") {
    content = <Result result={following.result} offerReload />;
  } else if (following.kind === "lost") {
    content = <span>No word from the update yet. Check back in a few minutes.</span>;
  } else if (following.kind === "problem") {
    content = <FormError message={following.message} />;
  } else if (live.newerOnMain && live.newest && live.build) {
    return (
      <MainBuildCard
        newest={live.newest}
        build={live.build}
        taps={taps}
        waiting={live.waiting}
        {...(props.label === undefined ? {} : { label: props.label })}
        {...(props.short === undefined ? {} : { short: props.short })}
      />
    );
  } else if (live.newerOnMain && live.newest) {
    // No build to go by (GitHub can't be asked): Update as it was before main's build showed,
    // and while it waits for sessions mid-turn, what for (#186).
    content =
      live.waiting === null ? (
        <>
          <span>A new version is ready: {live.newest.title}</span>
          <Button size="sm" onClick={taps.onUpdate}>
            Update
          </Button>
        </>
      ) : (
        <>
          <span>
            <Waiting waiting={live.waiting} />
          </span>
          <Button size="sm" variant="quiet" onClick={taps.onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="outline" onClick={taps.onUpdateNow}>
            Update now
          </Button>
        </>
      );
  } else if (
    live.lastUpdate &&
    isRecent(live.lastUpdate) &&
    live.lastUpdate.outcome !== "unchanged"
  ) {
    content = <Result result={live.lastUpdate} offerReload={false} />;
  }
  if (content === null) return props.keepsPlace ? <UpToDate running={live.running} /> : null;
  // On Home, in New version's row, at its height (#283).
  if (props.keepsPlace) {
    return (
      <section
        aria-label="Updates"
        aria-live="polite"
        className="flex h-12.5 items-center gap-3 rounded-bubble border bg-surface pr-2.5 pl-3.5 text-sm [&>span]:min-w-0 [&>span]:grow [&>span]:truncate"
      >
        {content}
      </section>
    );
  }

  return <InfoBox label="Updates">{content}</InfoBox>;
}

/** What's running, when there's nothing newer: one quiet row in New version's place (#283). */
function UpToDate(props: { running: LiveVersion }) {
  const { commit, words } = titleOf(props.running);
  return (
    <section
      aria-label="Up to date"
      className="flex h-12.5 items-center gap-3.5 rounded-bubble border bg-surface pr-3.5 pl-3.5"
    >
      <CapsLabel tone="muted" inline className="shrink-0 max-sm:hidden">
        Up to date
      </CapsLabel>
      <span className="min-w-0 grow truncate text-meta font-semibold text-muted-foreground">
        {words} · {commit}
      </span>
      <span className="shrink-0 text-meta font-semibold text-success">Live</span>
    </section>
  );
}
