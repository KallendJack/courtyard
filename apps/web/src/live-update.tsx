import type { LiveStatus, LiveUpdateResult } from "@courtyard/contract";
import { type ReactNode, useEffect, useState } from "react";
import { describeProblem } from "./problems.tsx";
import { type FromWorker, loadLive, startLiveUpdate } from "./worker.ts";

/** How often the page asks how an update is going. The worker is down for part of it. */
const FOLLOW_EVERY_MS = 3000;
/** Past this, the page stops waiting and says so. An update takes a minute or two. */
const FOLLOW_FOR_MS = 10 * 60 * 1000;
/** How long the last update's result stays on the home page. */
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

function Result({ result }: { result: LiveUpdateResult }) {
  if (result.outcome === "updated") {
    return (
      <>
        <span>{result.message}</span>
        {/* The page is still the old version until it's loaded again. */}
        <button type="button" onClick={() => window.location.reload()} className={BUTTON}>
          Reload
        </button>
      </>
    );
  }
  return <span>{result.message}</span>;
}

/** A plain button: shadcn's Button would put its class-merging code on the first load. */
const BUTTON =
  "h-8 shrink-0 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50";

/**
 * Updating the live app from the app (ADR 0011): a quiet notice when main has moved on, Update,
 * then how it went once the worker is back. Nothing at all on a worker that isn't a live copy.
 */
export function LiveUpdate(props: { result: FromWorker<LiveStatus> }) {
  const [status, setStatus] = useState(props.result);
  const [following, setFollowing] = useState<Following>(() => {
    const live = props.result.kind === "loaded" ? props.result.data : undefined;
    // Started from another device, or before this page was opened.
    return live?.kind === "live" && live.lastUpdate?.outcome === "running"
      ? { kind: "updating", since: null, at: Date.now() }
      : { kind: "idle" };
  });

  useEffect(() => {
    if (following.kind !== "updating") return;
    const timer = setInterval(async () => {
      if (Date.now() - following.at > FOLLOW_FOR_MS) return setFollowing({ kind: "lost" });
      const next = await loadLive();
      // While the worker restarts it doesn't answer; the page just asks again.
      if (next.kind !== "loaded" || next.data.kind !== "live") return;
      setStatus(next);
      const last = next.data.lastUpdate;
      if (last && last.finishedAt !== null && last.startedAt !== following.since) {
        setFollowing({ kind: "done", result: last });
      }
    }, FOLLOW_EVERY_MS);
    return () => clearInterval(timer);
  }, [following]);

  if (status.kind !== "loaded" || status.data.kind !== "live") return null;
  const live = status.data;

  const update = async () => {
    const since = live.lastUpdate?.startedAt ?? null;
    const started = await startLiveUpdate();
    setFollowing(
      started.kind === "loaded"
        ? { kind: "updating", since, at: Date.now() }
        : { kind: "problem", message: describeProblem(started).body },
    );
  };

  let content: ReactNode = null;
  if (following.kind === "updating") {
    content = <span>Updating. Courtyard restarts, and this page carries on by itself.</span>;
  } else if (following.kind === "done") {
    content = <Result result={following.result} />;
  } else if (following.kind === "lost") {
    content = <span>No word from the update yet. Check back in a few minutes.</span>;
  } else if (following.kind === "problem") {
    content = <span role="alert">{following.message}</span>;
  } else if (live.newerOnMain && live.newest) {
    content = (
      <>
        <span>A new version is ready: {live.newest.title}</span>
        <button type="button" onClick={update} className={BUTTON}>
          Update
        </button>
      </>
    );
  } else if (
    live.lastUpdate &&
    isRecent(live.lastUpdate) &&
    live.lastUpdate.outcome !== "unchanged"
  ) {
    content = <Result result={live.lastUpdate} />;
  }
  if (content === null) return null;

  return (
    <section
      aria-label="Updates"
      aria-live="polite"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-accent px-4 py-3 text-sm text-accent-foreground"
    >
      {content}
    </section>
  );
}
