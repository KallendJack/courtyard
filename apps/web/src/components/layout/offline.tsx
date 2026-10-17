import { CloudOff } from "lucide-react";
import { dayAndTimeWords } from "@/lib/when";

/**
 * Read offline's foot (#106; Paper, "Cover · Session, offline"): in place of the message box and
 * what needs the worker, while the device reads its copy, when that copy is from. Grey, not gold:
 * being offline isn't something that needs the owner.
 */
export function OfflineLine(props: { at: string }) {
  return (
    <div
      role="status"
      aria-label="Offline"
      className="flex items-center gap-3.5 rounded-bubble border bg-surface px-4 py-3"
    >
      <CloudOff aria-hidden className="size-4.5 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-bold">Offline · reading a copy</span>
        <span className="text-meta text-muted-foreground">
          Last updated {dayAndTimeWords(props.at)}
        </span>
      </span>
    </div>
  );
}

/** What a tab, block or session offline says when its copy doesn't keep it (#106): one quiet line. */
export function NotKept() {
  return <p className="py-2 text-sm text-muted-foreground">Not kept offline</p>;
}
