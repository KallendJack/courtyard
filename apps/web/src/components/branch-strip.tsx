import type { PullRequest } from "@courtyard/contract";
import { GitBranch } from "lucide-react";
import { classes } from "@/lib/classes";

/** A chip in the strip: the session branch, or its pull request. */
const CHIP = "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md bg-surface px-3";

/**
 * Where a pull request stands, in a few words, and how it looks: live (violet) while it's open and
 * its checks run or pass, failed (red) when one fails, and quiet once it's closed.
 */
const standing = (pullRequest: PullRequest, fixing: boolean) => {
  if (pullRequest.state === "merged") return { tone: "live", text: "merged" } as const;
  if (pullRequest.state === "closed") return { tone: "quiet", text: "closed" } as const;
  const { checks } = pullRequest;
  switch (checks.kind) {
    case "none":
      return { tone: "quiet", text: "open" } as const;
    case "running":
      return { tone: "running", text: "checks running" } as const;
    case "passed":
      return { tone: "live", text: "checks passed" } as const;
    case "failed":
      return {
        tone: "failed",
        text: `${checks.failed.join(", ")} failed${fixing ? " · fixing it" : ""}`,
      } as const;
  }
};

const DOT = {
  quiet: "bg-muted-foreground",
  running: "animate-pulse bg-primary",
  live: "bg-primary",
  failed: "bg-destructive",
} as const;

/**
 * A code session's branch and pull request at a glance (#172), under its title: the session
 * branch, and once it has one, its pull request's number (a link to it on GitHub) and where its
 * checks stand, saying when the session is fixing a failed one. Safe on the first load (ADR 0012).
 */
export function BranchStrip(props: {
  branch: string;
  pullRequest: PullRequest | undefined;
  /** The session is working on a fix for the checks that failed. */
  fixing: boolean;
}) {
  const { pullRequest } = props;
  const now = pullRequest === undefined ? undefined : standing(pullRequest, props.fixing);
  return (
    <section
      aria-label="Branch and pull request"
      className="flex flex-wrap items-center gap-2 text-xs"
    >
      <span className={classes(CHIP, "font-mono text-foreground")}>
        <GitBranch aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{props.branch}</span>
      </span>
      {pullRequest !== undefined && now !== undefined && (
        <a
          href={pullRequest.url}
          target="_blank"
          rel="noreferrer"
          className={classes(CHIP, "hover:bg-muted")}
        >
          <span className="font-extrabold text-foreground">PR #{pullRequest.number}</span>
          <span aria-hidden className={classes("size-1.5 shrink-0 rounded-full", DOT[now.tone])} />
          <span
            className={classes(
              "truncate font-bold",
              now.tone === "failed" ? "text-destructive-text" : "text-muted-foreground",
            )}
          >
            {now.text}
          </span>
        </a>
      )}
    </section>
  );
}
