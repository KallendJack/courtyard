import type { LiveUpdateResult } from "@courtyard/contract";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { InfoBox } from "@/components/notice";
import { describeProblem } from "../problems.tsx";
import { loadLive, startLiveUpdate } from "./api.ts";
import { MainBuildCard, useLive } from "./main-build.tsx";

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
 * (#102), main's build is a row, labelled `label` ("New version"), `short` on a narrow screen.
 * `live` is the live status as a page already asks for it, so that page knows when it's known.
 */
export function LiveUpdate(props: {
  label?: string;
  short?: boolean;
  live?: ReturnType<typeof useLive>;
}) {
  const own = useLive(props.live === undefined);
  const [status, setStatus] = props.live ?? own;
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

  if (status?.kind !== "loaded" || status.data.kind !== "live") return null;
  const live = status.data;

  const update = async () => {
    const since = live.lastUpdate?.startedAt ?? null;
    const started = await startLiveUpdate();
    // Already running (started on another device, say): this page follows that one.
    const alreadyRunning = started.kind === "failed" && started.status === 409;
    setFollowing(
      started.kind === "loaded" || alreadyRunning
        ? { kind: "updating", since, at: Date.now() }
        : { kind: "problem", message: describeProblem(started).body },
    );
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
        onUpdate={update}
        {...(props.label === undefined ? {} : { label: props.label })}
        {...(props.short === undefined ? {} : { short: props.short })}
      />
    );
  } else if (live.newerOnMain && live.newest) {
    // No build to go by (GitHub can't be asked): Update as it was before main's build showed.
    content = (
      <>
        <span>A new version is ready: {live.newest.title}</span>
        <Button size="sm" onClick={update}>
          Update
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
  if (content === null) return null;

  return <InfoBox label="Updates">{content}</InfoBox>;
}
