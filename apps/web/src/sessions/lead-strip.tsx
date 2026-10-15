import type { LeadStatus, WorkspaceId } from "@courtyard/contract";
import { Link } from "@tanstack/react-router";
import { CapsLabel } from "@/components/caps-label";
import { createKept, PlaceholderRows, useKept } from "@/components/kept";
import { classes } from "@/lib/classes";
import { loadLead } from "../code-home/api.ts";

/** Each workspace's Lead as last shown, for the tab's lifetime. */
const KEPT_LEAD = createKept<LeadStatus>();

const CARD = "flex min-w-0 flex-col gap-1.5 rounded-lg border bg-surface px-3 py-2.5";

/**
 * The strip at the top of a code workspace's Lead's chat (#347; Paper, "Tablet · Lead chat"):
 * what's building, each a tap to its session; the next two issues; and how many pull requests
 * are ready to merge. Asked for again as the chat's events come (`again`). Its own lazy load, so
 * the Lead's schemas stay off the first load.
 */
export default function LeadStrip(props: { workspaceId: WorkspaceId; again: unknown }) {
  const lead = useKept(KEPT_LEAD, {
    key: props.workspaceId,
    load: async () => {
      const loaded = await loadLead(props.workspaceId);
      return loaded.kind === "loaded" ? loaded.data : undefined;
    },
    again: props.again,
  });
  if (lead === undefined) return <PlaceholderRows count={1} size="tall" />;
  const issueOf = (title: string) => title.replace(/^Build (#\d+): /, "$1 ");
  return (
    <section aria-label="Build order" className="flex gap-2">
      <div className={classes(CARD, "grow-[1.4] basis-0 border-primary/35")}>
        <CapsLabel tone="primary" heading={{ level: 2 }}>
          Building · {lead.building.length}
        </CapsLabel>
        {lead.building.length === 0 ? (
          <p className="text-meta text-muted-foreground">
            {lead.state === "resting"
              ? "Resting"
              : lead.state === "paused"
                ? "Paused"
                : "Nothing yet"}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {lead.building.map((builder) => (
              <li key={builder.session}>
                <Link
                  to="/workspaces/$workspaceId/sessions/$sessionId"
                  params={{ workspaceId: props.workspaceId, sessionId: builder.session }}
                  className="flex items-center gap-2 hover:underline"
                >
                  <span aria-hidden className="size-1.75 shrink-0 rounded-full bg-primary" />
                  <span className="truncate text-meta font-bold">{issueOf(builder.title)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={classes(CARD, "grow basis-0")}>
        <CapsLabel tone="muted" heading={{ level: 2 }}>
          Next
        </CapsLabel>
        {lead.next.length === 0 ? (
          <p className="text-meta text-muted-foreground">Nothing ready</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {lead.next.map((issue) => (
              <li
                key={issue.number}
                className="truncate text-meta font-semibold text-foreground/90"
              >
                #{issue.number} {issue.title}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={classes(CARD, "w-30 shrink-0 justify-between")}>
        <CapsLabel tone="muted" heading={{ level: 2 }}>
          To merge
        </CapsLabel>
        <p
          className={classes(
            "text-sheet-title font-extrabold",
            lead.ready.length > 0 ? "text-success" : "text-muted-foreground",
          )}
        >
          {lead.ready.length}
        </p>
      </div>
    </section>
  );
}
