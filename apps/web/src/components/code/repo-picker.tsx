import type { GitHubRepo } from "@courtyard/contract";
import { type ReactNode, useId } from "react";
import { classes } from "@/lib/classes";
import { Scroller } from "../layout/scroller.tsx";

/**
 * Code's mark, as the board draws it: a pair of angle brackets. Drawn here rather than taken from
 * lucide, so New workspace's load doesn't split lucide's shared code off the first load's files
 * into one more file of its own.
 */
export function CodeMark(props: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={props.className}>
      <path
        d="M8 7l-5 5 5 5M16 7l5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** New repo's mark (#391): a plus, drawn here for the same reason as Code's. */
function PlusMark(props: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={props.className}>
      <path
        d="M12 5v14M5 12h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The owner's GitHub repos to pick one from, for a new code workspace (#258, Paper board "Tablet ·
 * New workspace, Code"): each its mark, its name and whether it's private, the picked one ringed in
 * violet. Those a code workspace works on already are greyed, marked Added, and can't be picked.
 * Radio buttons, so the keyboard and screen readers treat them as one. Its classes are off the
 * first load, in the stylesheet of the page that uses it (new-workspace.css), and apply only
 * inside it.
 */
export function RepoPicker(props: {
  repos: readonly GitHubRepo[];
  value: string | undefined;
  onChange: (repo: GitHubRepo) => void;
  /** New repo (#391), heading the list: a repo made on the house standard. */
  newRepo?: { chosen: boolean; onChoose: () => void };
}) {
  const name = useId();
  const { newRepo } = props;
  return (
    <fieldset className="flex max-h-60 min-w-0 flex-col rounded-card border bg-surface">
      <legend className="sr-only">Repo</legend>
      <Scroller className="flex min-h-0 flex-col gap-0.5 p-1.5">
        {newRepo !== undefined && (
          <Row
            name={name}
            value=""
            look={newRepo.chosen ? "chosen" : "open"}
            onChoose={newRepo.onChoose}
            mark={<PlusMark className="size-4.5" />}
            title="New repo"
            aside={<span className="text-primary-text">On the house standard</span>}
          />
        )}
        {props.repos.map((repo) => (
          <Row
            key={repo.repo}
            name={name}
            value={repo.repo}
            look={repo.repo === props.value ? "chosen" : repo.added ? "added" : "open"}
            onChoose={() => props.onChange(repo)}
            mark={<CodeMark className="size-4.5" />}
            title={repo.name}
            aside={repo.added ? "Added" : repo.private ? "Private" : "Public"}
          />
        ))}
      </Scroller>
    </fieldset>
  );
}

/**
 * One row to pick: its mark, its name and a word on the right, ringed in violet when it's the one
 * picked. One a code workspace works on already is greyed and can't be picked.
 */
function Row(props: {
  name: string;
  value: string;
  look: "chosen" | "open" | "added";
  onChoose: () => void;
  mark: ReactNode;
  title: string;
  aside: ReactNode;
}) {
  const { look } = props;
  return (
    <label
      className={classes(
        "flex h-13 shrink-0 items-center gap-3 rounded-row border-stroke px-3 select-none has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
        look === "chosen"
          ? "border-primary bg-primary/8"
          : look === "added"
            ? "border-transparent"
            : "cursor-pointer border-transparent active:bg-accent",
      )}
    >
      <input
        type="radio"
        name={props.name}
        value={props.value}
        checked={look === "chosen"}
        disabled={look === "added"}
        onChange={props.onChoose}
        className="sr-only"
      />
      <span
        aria-hidden
        className={classes(
          "flex size-8 shrink-0 items-center justify-center rounded-md bg-muted",
          look === "chosen"
            ? "text-foreground/90"
            : look === "added"
              ? "text-placeholder"
              : "text-muted-foreground",
        )}
      >
        {props.mark}
      </span>
      <span
        className={classes(
          "min-w-0 flex-1 truncate text-base/5",
          look === "chosen"
            ? "font-bold text-foreground"
            : look === "added"
              ? "font-semibold text-placeholder"
              : "font-semibold text-foreground/85",
        )}
      >
        {props.title}
      </span>
      <span
        className={classes(
          "shrink-0 text-right text-meta/4 font-medium",
          look === "added" ? "text-placeholder" : "text-muted-foreground",
        )}
      >
        {props.aside}
      </span>
    </label>
  );
}
