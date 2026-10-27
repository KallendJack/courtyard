const time = (date: Date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The time of day something happened, as a clock shows it: "10:42". */
export const clockWords = (iso: string) => time(new Date(iso));

/** The day of the week and the time of day something happened: "Sat 14:32". */
export const dayAndTimeWords = (iso: string) => {
  const date = new Date(iso);
  return `${date.toLocaleDateString([], { weekday: "short" })} ${time(date)}`;
};

/** A day as people say it, from its date (`2026-10-23`): "23 Oct". */
export const dayWords = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** How long something has taken, as a clock shows it: "0:40", "2:14", "1:02:14". */
export const elapsedWords = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}:${two(seconds % 60)}`
    : `${Math.floor(minutes / 60)}:${two(minutes % 60)}:${two(seconds % 60)}`;
};

/** How long ago something happened, while it's today: "just now", "4 min ago", "2 h ago". */
export const agoWords = (iso: string, now = new Date()) => {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return describeWhen(iso, now);
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
