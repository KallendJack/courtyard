import type { WorkspaceId } from "@courtyard/contract";
import { Link } from "@tanstack/react-router";
import { classes } from "@/lib/classes";
import { Scroller } from "./scroller.tsx";

/** One of a workspace's tabs: its place in the address's hash (none for Home), name and count. */
export type WorkspaceTab = {
  readonly hash: string;
  readonly label: string;
  /** How many it holds, shown after its name; none for Home. */
  readonly count?: number;
};

/**
 * A workspace's tabs (#300, #301; Paper, "Tablet · Code workspace Home"): Home, then each tab that
 * has something (Sessions, PRs or Things, Docs) with its count, the chosen one ringed in violet.
 * Each is a link to its hash on the workspace's page, so Back goes back a tab. A row that scrolls
 * sideways when it's wider than the screen (the cover screen). Its classes are in the stylesheet
 * of the page that shows it (code-home.css), off the first load.
 */
export function WorkspaceTabs(props: {
  workspaceId: WorkspaceId;
  tabs: readonly WorkspaceTab[];
  /** The chosen tab's hash. */
  chosen: string;
}) {
  return (
    <Scroller
      as="nav"
      axis="x"
      aria-label="Workspace tabs"
      className="-mx-4 flex gap-2 px-4 md:mx-0 md:px-0"
    >
      {props.tabs.map((tab) => {
        const chosen = tab.hash === props.chosen;
        return (
          <Link
            key={tab.hash}
            to="/workspaces/$workspaceId"
            params={{ workspaceId: props.workspaceId }}
            hash={tab.hash}
            {...(chosen ? { "aria-current": "page" } : {})}
            className={classes(
              "flex h-11 shrink-0 items-center gap-2 rounded-full px-4.5 text-interface outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              chosen
                ? "border-stroke border-primary-text bg-primary/12 font-bold text-foreground"
                : "bg-secondary font-semibold text-foreground/85 hover:bg-muted",
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="text-label font-semibold text-placeholder">{tab.count}</span>
            )}
          </Link>
        );
      })}
    </Scroller>
  );
}
