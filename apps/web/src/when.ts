const time = (date: Date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

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
