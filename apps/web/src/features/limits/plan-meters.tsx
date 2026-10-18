import type { ModelUsageMeter, PlanUsage } from "@courtyard/contract";
import { classes } from "@/lib/classes";
import { percent, readingAge, resetsWords, standingOf, windowName } from "./words.ts";

/** Each standing's bar and number: violet with room, gold near the limit, red at it. */
const TONES = {
  room: { bar: "bg-primary", number: "text-foreground" },
  near: { bar: "bg-warning", number: "text-warning" },
  full: { bar: "bg-destructive", number: "text-destructive-text" },
} as const;

/**
 * One window's meter (Paper, "Tablet · Model sheet: plan meters (#66)"): its name, a thin bar,
 * how much is used and when it resets; "Limit reached" at 100%, and "not known yet" for a window
 * the worker hasn't heard of, never a guess.
 */
function MeterRow(props: {
  name: string;
  used: number | null;
  resetAt: string | undefined;
  nested?: boolean;
}) {
  const { used } = props;
  const tone = used === null ? undefined : TONES[standingOf(used)];
  const resets = resetsWords(props.resetAt);
  const side =
    used === null
      ? "not known yet"
      : used >= 100
        ? ["Limit reached", resets].filter(Boolean).join(" · ")
        : resets;
  // A span, so it can sit in a model's row, inside its label.
  return (
    <span
      className={classes(
        "flex min-w-0 items-center gap-3 text-meta",
        props.nested === true && "border-l-2 border-border pl-2.5",
      )}
    >
      <span
        className={classes(
          "w-20 shrink-0 truncate",
          props.nested === true
            ? "font-semibold text-muted-foreground"
            : "font-bold text-foreground",
        )}
      >
        {props.name}
      </span>
      {/* The bar only draws the number beside it, which is what screen readers get. */}
      <span aria-hidden className="h-1 min-w-6 flex-1 overflow-hidden rounded-full bg-muted">
        {tone !== undefined && used !== null && (
          <span
            className={classes("block h-full rounded-full", tone.bar)}
            style={{ width: `${Math.min(used, 100)}%` }}
          />
        )}
      </span>
      <span
        className={classes(
          "w-10 shrink-0 text-right font-bold tabular-nums",
          tone?.number ?? "text-muted-foreground",
        )}
      >
        {used === null ? "–" : percent(used)}
      </span>
      {/* Its words whole; under a model, beside its radio mark, cut short on a narrow screen. */}
      <span
        className={classes(
          "text-right whitespace-nowrap text-muted-foreground",
          // At least as wide as most, so the bars above and below end together.
          props.nested === true ? "min-w-0 truncate" : "min-w-28 shrink-0",
        )}
      >
        {side}
      </span>
    </span>
  );
}

/**
 * A provider's plan meters above its models in the Model sheet (#66): its 5-hour window and its
 * week, saying when they were read once that's over an hour ago; or one quiet line for a sign-in
 * with no plan limits.
 */
export function PlanMeters(props: { label: string; usage: PlanUsage }) {
  const { usage } = props;
  if (usage.kind === "no-plan") {
    return (
      <p className="px-1 pb-1 text-meta text-muted-foreground">No plan limits for this sign-in</p>
    );
  }
  const age = readingAge(usage.readAt);
  return (
    <section
      aria-label={`${props.label}'s plan limits`}
      className="flex flex-col gap-2 rounded-bubble bg-surface px-3.5 py-3"
    >
      {usage.meters.map((meter) => (
        <MeterRow
          key={meter.window}
          name={windowName(meter.window)}
          used={meter.used}
          resetAt={meter.resetAt}
        />
      ))}
      {age !== undefined && <p className="text-right text-meta text-muted-foreground">{age}</p>}
    </section>
  );
}

/**
 * A model family's own weekly limit, nested under that model in the Model sheet (#66), once it's
 * past the warning; nothing otherwise.
 */
export function ModelMeter(props: { meter: ModelUsageMeter }) {
  const { meter } = props;
  return <MeterRow name={`${meter.name} week`} used={meter.used} resetAt={meter.resetAt} nested />;
}
