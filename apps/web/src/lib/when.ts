const time = (date: Date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The time of day something happened, as a clock shows it: "10:42". */
export const clockWords = (iso: string) => time(new Date(iso));

/** The day of the week and the time of day something happened: "Sat 14:32". */
export const dayAndTimeWords = (iso: string) => {
  const date = new Date(iso);
  return `${date.toLocaleDateString([], { weekday: "short" })} ${time(date)}`;
};

/** How long something has taken, as a clock shows it: "0:40", "2:14", "1:02:14". */
export const elapsedWords = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}:${two(seconds % 60)}`
    : `${Math.floor(minutes / 60)}:${two(minutes % 60)}:${two(seconds % 60)}`;
};

/** How fresh something is, in days: "today", "yesterday" or "6 days ago" (a price checked, #245). */
export const daysAgoWords = (iso: string, now = new Date()) => {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysAgo = Math.max(0, Math.round((day(now) - day(new Date(iso))) / 86_400_000));
  if (daysAgo === 0) return "today";
  return daysAgo === 1 ? "yesterday" : `${daysAgo} days ago`;
};

/** When something happened, the way people say it: "Today, 18:42", "Yesterday" or "2 Oct". */
export const describeWhen = (iso: string, now = new Date()) => {
  const date = new Date(iso);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysAgo = Math.round((day(now) - day(date)) / 86_400_000);
  if (daysAgo === 0) return `Today, ${time(date)}`;
  if (daysAgo === 1) return "Yesterday";
  return date.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
};
