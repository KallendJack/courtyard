import type { LeadStatus, WorkspaceId } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { createKept, PlaceholderRows, useKept } from "@courtyard/ui/layout/kept.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { Link } from "@tanstack/react-router";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { loadLead } from "../../code-home/api.ts";
import { useMergeInOrder } from "../../code-home/merge-in-order.ts";

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
      <div className={classes(CARD, "min-w-30 shrink-0 justify-between")}>
        <CapsLabel tone="muted" heading={{ level: 2 }}>
          To merge
        </CapsLabel>
        <div className="flex items-center justify-between gap-3">
          <p
            className={classes(
              "text-sheet-title font-extrabold",
              lead.ready.length > 0 ? "text-success" : "text-muted-foreground",
            )}
          >
            {lead.ready.length}
          </p>
          <MergeState lead={lead} workspaceId={props.workspaceId} />
        </div>
      </div>
    </section>
  );
}

/** A pill in the To merge card: where Merge in order is (#423). */
const PILL = "rounded-full px-3 py-1 text-meta font-bold whitespace-nowrap";

/**
 * Merge in order in the Lead's To merge card (#423; Paper, "Lead chat, merging in order" and
 * "merge stopped at a check"): the button while pull requests are ready, the one it's merging, or
 * the one it stopped at, in gold, since that waits on the owner.
 */
function MergeState(props: { lead: LeadStatus; workspaceId: WorkspaceId }) {
  const { merge, ready } = props.lead;
  const tap = useMergeInOrder({
    workspaceId: props.workspaceId,
    pullRequests: ready.map((each) => each.pullRequest),
    onMerging: (lead) => KEPT_LEAD.set(props.workspaceId, lead),
  });
  if (merge?.kind === "stopped") {
    return (
      <span className={classes(PILL, "bg-warning/15 text-warning")}>
        Stopped · #{merge.pullRequest}
      </span>
    );
  }
  if (merge?.kind === "merging") {
    return (
      <span className={classes(PILL, "bg-primary/15 text-primary-text")}>
        Merging · #{merge.pullRequest}
      </span>
    );
  }
  if (ready.length === 0) return null;
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="xs" busy={tap.busy} busyLabel="Merging…" onClick={() => void tap.run()}>
        Merge in order
      </Button>
      <FormError message={tap.error} />
    </div>
  );
}
