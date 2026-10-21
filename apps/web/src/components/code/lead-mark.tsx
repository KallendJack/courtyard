// A code workspace's Lead (#347; Paper, "Tablet · Code Home, Lead running"): its small violet
// mark, first in Sessions, and the tag its builders carry in every list of sessions.

/** The Lead's mark: "LEAD" in a violet pill, before its row. */
export function LeadMark() {
  return (
    <span className="flex h-5.5 shrink-0 items-center rounded-full bg-primary px-2 text-caption/3 font-extrabold tracking-label text-primary-foreground uppercase">
      Lead
    </span>
  );
}

/** "by Lead": a session the Lead started to build an issue. */
export function ByLead() {
  return <span className="shrink-0 text-caption font-bold text-primary-text">by Lead</span>;
}
