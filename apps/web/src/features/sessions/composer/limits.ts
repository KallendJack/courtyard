import type { UsageLimit } from "@courtyard/contract";

const time = (date: Date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** How many days from `now`'s day to `date`'s, by the calendar rather than by hours. */
const daysAhead = (date: Date, now: Date) => {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((day(date) - day(now)) / 86_400_000);
};

/**
 * When a usage limit resets, the way a notice says it: "today at 18:30", "tomorrow at 09:00",
 * "Thursday at 14:00" within the week, else "14 Oct at 14:00".
 */
export const resetsWhen = (iso: string, now = new Date()) => {
  const date = new Date(iso);
  const days = daysAhead(date, now);
  const day =
    days <= 0
      ? "today"
      : days === 1
        ? "tomorrow"
        : days < 7
          ? date.toLocaleDateString([], { weekday: "long" })
          : date.toLocaleDateString([], { day: "numeric", month: "short" });
  return `${day} at ${time(date)}`;
};

/** The same, as short as a picker needs: "18:30" today, "Thu 14:00" within the week, else "14 Oct". */
const resetsShort = (iso: string, now = new Date()) => {
  const date = new Date(iso);
  const days = daysAhead(date, now);
  if (days <= 0) return time(date);
  if (days < 7) return `${date.toLocaleDateString([], { weekday: "short" })} ${time(date)}`;
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
};

/** A model at its usage limit, as the picker says it: "limit reached, resets Thu 14:00". */
export const limitLabel = (limit: UsageLimit) =>
  limit.resetAt === undefined
    ? "limit reached"
    : `limit reached, resets ${resetsShort(limit.resetAt)}`;
