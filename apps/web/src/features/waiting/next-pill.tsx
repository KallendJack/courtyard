import type { SessionId } from "@courtyard/contract";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { needLink, needWords, useNeedsYou } from "./api.ts";

/**
 * The Next pill (#492; Paper, "Session, Next pill"): in a session's chip row, gold, the first
 * thing waiting on the owner anywhere else, "Next · Approve in Build #285", opening it in one
 * tap. Only while something else waits; nothing otherwise. `again` asks afresh (a turn here
 * ended, an approval was answered).
 */
export function NextPill(props: { sessionId: SessionId; again?: unknown }) {
  const known = useNeedsYou(props.again);
  const next = known?.needs.find((need) => need.session.id !== props.sessionId);
  if (next === undefined) return null;
  const words = `Next · ${needWords(next)} in ${next.session.title}`;
  return (
    <Link
      {...needLink(next)}
      aria-label={words}
      className="inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 text-meta font-bold text-warning hover:bg-warning/15"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
      <span className="truncate">{words}</span>
      <ChevronRight aria-hidden className="size-3.5 shrink-0" />
    </Link>
  );
}
