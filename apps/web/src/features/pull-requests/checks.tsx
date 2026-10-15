import type { PullRequest } from "@courtyard/contract";
import { classes } from "@/lib/classes";

/**
 * Where a pull request stands, in a few words and its colour (AGENTS.md): checks passed in moss,
 * running in violet (live, as the branch strip has it), failed in red, a conflict with its base in
 * gold, since it needs the owner (#278), and quiet when it has none or has ended.
 */
const standing = (pullRequest: PullRequest, base = "its base") => {
  if (pullRequest.state === "merged") return { tone: "passed", text: "Merged" } as const;
  if (pullRequest.state === "closed") return { tone: "quiet", text: "Closed" } as const;
  // Its checks may not run at all while it conflicts, so that's what it says, not "No checks".
  if (pullRequest.conflicts) return { tone: "needs", text: `Conflicts with ${base}` } as const;
  const { checks } = pullRequest;
  switch (checks.kind) {
    case "none":
      return { tone: "quiet", text: "No checks" } as const;
    case "running":
      return { tone: "running", text: "Checks running" } as const;
    case "passed":
      return { tone: "passed", text: "Checks passed" } as const;
    case "failed": {
      const count = checks.failed.length;
      return {
        tone: "failed",
        text: `${count} ${count === 1 ? "check" : "checks"} failed`,
      } as const;
    }
  }
};

const TONES = {
  passed: { dot: "bg-success", text: "text-success", chip: "border-success/25 bg-success/8" },
  running: { dot: "bg-primary", text: "text-primary-text", chip: "border-primary/25 bg-primary/8" },
  failed: {
    dot: "bg-destructive",
    text: "text-destructive",
    chip: "border-destructive/25 bg-destructive/8",
  },
  needs: { dot: "bg-warning", text: "text-warning", chip: "border-warning/25 bg-warning/8" },
  quiet: { dot: "bg-muted-foreground", text: "text-muted-foreground", chip: "border-input" },
} as const;

/**
 * A pull request's checks at a glance (#240; Paper, "Tablet · PRs tab" and "Tablet · PR review"):
 * a dot and a few words, on a row of the PRs list, or as a chip under a review's title.
 */
export function ChecksState(props: {
  pullRequest: PullRequest;
  /** The branch it merges into, which a conflict names, once known. */
  base: string | undefined;
  chip?: boolean;
}) {
  const now = standing(props.pullRequest, props.base);
  const tone = TONES[now.tone];
  return (
    <span
      className={classes(
        "inline-flex shrink-0 items-center gap-2 text-meta/4 font-semibold",
        tone.text,
        props.chip && classes("h-7 rounded-full border px-2.5", tone.chip),
      )}
    >
      <span
        aria-hidden
        className={classes(
          "size-2 shrink-0 rounded-full",
          tone.dot,
          now.tone === "running" && "animate-pulse",
        )}
      />
      {now.text}
    </span>
  );
}
