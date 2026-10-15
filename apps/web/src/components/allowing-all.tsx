import type { AllowingAll } from "@courtyard/contract";
import { useEffect, useState } from "react";
import { useAction } from "@/lib/use-action";
import { Button } from "./button.tsx";
import { FormError } from "./form-error.tsx";

// Allow all for this task (#428; Paper, "Session allowing all, strip and marked steps" and "Code
// Home: Running rows marked Allowing all"): gold, since it's something the owner chose to stop
// being asked about, and so always in sight while it's on.

const MINUTE_MS = 60_000;

/**
 * How long until `until`, in a few words: "3 h 12 min", "52 min", "under a minute"; `roughly`, in
 * whole hours once it's an hour or more ("11 h"), where a row has room for little.
 */
export const timeLeft = (left: { until: string; now: number; roughly?: boolean }) => {
  const { until, now, roughly = false } = left;
  const minutes = Math.floor((Date.parse(until) - now) / MINUTE_MS);
  if (minutes < 1) return "under a minute";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 || roughly ? `${hours} h` : `${hours} h ${rest} min`;
};

/**
 * The time now, again every half minute while `until` is ahead, so what's left counts down; once
 * it has passed, `onPast` asks the worker again, which decides whether it's still on.
 */
const useClock = (until: string, onPast: () => void) => {
  const [now, setNow] = useState(() => Date.now());
  const past = Date.parse(until) <= now;
  useEffect(() => {
    if (past) {
      onPast();
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), MINUTE_MS / 2);
    return () => clearInterval(timer);
  }, [past, onPast]);
  return { now, past };
};

/**
 * What a session allowing all says of how long (#428): until its PR opens (or, with one open
 * already, until it's done), and how long at most; or how long is left.
 */
const howLong = (on: { allowing: AllowingAll; pullRequestOpen: boolean; now: number }) => {
  const left = timeLeft({ until: on.allowing.until, now: on.now });
  return on.allowing.task
    ? `until ${on.pullRequestOpen ? "it's done" : "the PR opens"} · ${left} at most`
    : `${left} left`;
};

/**
 * The gold strip at the top of a session allowing all (#428), under its branch: "Allowing all ·
 * 52 min left", with Turn off. It counts down, and goes once the time has passed. Safe on the
 * first load (ADR 0012).
 */
export function AllowingAllStrip(props: {
  allowing: AllowingAll;
  /** The session has an open pull request already, so "until it's done" rather than "the PR opens". */
  pullRequestOpen: boolean;
  /** Turns it off: what went wrong, or nothing once it's off. */
  onTurnOff: () => Promise<string | undefined>;
  /** Its time passed: the page asks the worker again. */
  onPast: () => void;
}) {
  const { now, past } = useClock(props.allowing.until, props.onPast);
  const off = useAction(props.onTurnOff);
  if (past) return null;
  return (
    <section aria-label="Allowing all" className="flex flex-col gap-1.5">
      <div className="flex min-h-11 items-center gap-2.5 rounded-row border border-warning/40 bg-warning/10 py-1.5 pr-1.5 pl-3.5">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning" />
        <p className="min-w-0 grow text-meta font-bold text-warning">
          Allowing all ·{" "}
          {howLong({ allowing: props.allowing, pullRequestOpen: props.pullRequestOpen, now })}
        </p>
        <Button
          variant="outline"
          size="xs"
          busy={off.busy}
          busyLabel="Turning off…"
          onClick={() => void off.run()}
        >
          Turn off
        </Button>
      </div>
      <FormError message={off.error} />
    </section>
  );
}

/**
 * Allow all's small gold mark (#428): "Allowing all" on a session's row in Running while it allows
 * all, "ran under Allow all" on a step that ran without asking.
 */
export function AllowAllMark(props: { children: string }) {
  return (
    <span className="shrink-0 rounded-sm bg-warning/15 px-1.5 py-px text-caption font-bold text-warning">
      {props.children}
    </span>
  );
}
