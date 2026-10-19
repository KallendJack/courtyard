import type { WorkspaceId } from "@courtyard/contract";
import { Link } from "@tanstack/react-router";
import { classes } from "@/lib/classes";
import { Scroller } from "../layout/scroller.tsx";

/** One of a workspace's tabs: its place in the address's hash (none for Home), name and count. */
export type WorkspaceTab = {
  readonly hash: string;
  readonly label: string;
  /**
   * How many it holds, shown after its name; none for Home. `"unknown"` while it's still to come:
   * its room kept, drawn invisible, so the tabs don't move when it does (#503).
   */
  readonly count?: number | "unknown";
  /** What it holds can't be shown now: read offline, the copy doesn't keep it (#106). */
  readonly faint?: boolean;
  /**
   * Not there, but its place kept (#503): beside the title the tabs end at the ⋯, so one coming
   * in late would push those before it aside. Drawn invisible, and out of reach.
   */
  readonly held?: boolean;
};

/**
 * A tab's count: as wide as two digits, each digit as wide as any other, so a count coming in, or
 * going from 9 to 13, takes the room kept for it and the tabs beside the title don't move (#503).
 */
const COUNT = "min-w-[2ch] text-label font-semibold tabular-nums";

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
  /**
   * A planning workspace's pills (#481; Paper, "Tablet · Home: the bike, parts pinned"): an
   * action first, in a tab's look (+ New), and no Home tab, the chosen tab leading back to Home.
   */
  pills?: { readonly action: { readonly label: string; readonly onClick: () => void } };
}) {
  const { pills } = props;
  return (
    <Scroller
      as="nav"
      axis="x"
      aria-label="Workspace tabs"
      className="-mx-4 flex gap-2 px-4 md:mx-0 md:px-0"
    >
      {pills !== undefined && (
        <button
          type="button"
          onClick={pills.action.onClick}
          className="flex h-11 shrink-0 items-center rounded-full bg-secondary px-4.5 text-interface font-semibold text-foreground/85 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {pills.action.label}
        </button>
      )}
      {props.tabs.map((tab) => {
        const chosen = tab.hash === props.chosen;
        if (tab.held === true) {
          return (
            <span
              key={tab.hash}
              aria-hidden
              className="invisible flex h-11 shrink-0 items-center gap-2 px-4.5 text-interface font-semibold"
            >
              {tab.label}
              {tab.count !== undefined && <span className={COUNT}>0</span>}
            </span>
          );
        }
        return (
          <Link
            key={tab.hash}
            to="/workspaces/$workspaceId"
            params={{ workspaceId: props.workspaceId }}
            hash={chosen && pills !== undefined ? "" : tab.hash}
            // Only the chosen tab is the page: every tab is the same page by its path.
            activeOptions={{ includeHash: true }}
            {...(chosen ? { "aria-current": "page" } : {})}
            className={classes(
              "flex h-11 shrink-0 items-center gap-2 rounded-full px-4.5 text-interface outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              chosen
                ? "border-stroke border-primary-text bg-primary/12 font-bold text-foreground"
                : tab.faint === true
                  ? "bg-secondary/50 font-semibold text-placeholder"
                  : "bg-secondary font-semibold text-foreground/85 hover:bg-muted",
            )}
          >
            {tab.label}
            {tab.count === "unknown" ? (
              <span aria-hidden className={classes(COUNT, "invisible")}>
                0
              </span>
            ) : (
              tab.count !== undefined && (
                <span className={classes(COUNT, "text-placeholder")}>{tab.count}</span>
              )
            )}
          </Link>
        );
      })}
    </Scroller>
  );
}
