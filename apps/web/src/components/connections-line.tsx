import type { WorkspaceConnections } from "@courtyard/contract";
import { ChevronRight } from "lucide-react";
import { classes } from "@/lib/classes";

/** GitHub's mark, in the colour of the text around it. */
export function GitHubMark(props: { size: number }) {
  return (
    <svg
      aria-hidden
      width={props.size}
      height={props.size}
      viewBox="0 0 16 16"
      className="shrink-0"
    >
      <path
        fill="currentColor"
        d="M8 1.2a6.8 6.8 0 0 0-2.15 13.25c.34.06.46-.15.46-.33v-1.2c-1.9.41-2.3-.8-2.3-.8-.31-.79-.76-1-.76-1-.62-.42.05-.41.05-.41.68.05 1.04.7 1.04.7.61 1.04 1.6.74 1.99.57.06-.44.24-.74.43-.91-1.51-.17-3.1-.76-3.1-3.37 0-.74.27-1.35.7-1.83-.07-.17-.3-.86.07-1.8 0 0 .57-.18 1.87.7a6.5 6.5 0 0 1 3.4 0c1.3-.88 1.87-.7 1.87-.7.37.94.14 1.63.07 1.8.44.48.7 1.09.7 1.83 0 2.62-1.6 3.2-3.11 3.37.24.21.46.62.46 1.25v1.85c0 .18.12.4.47.33A6.8 6.8 0 0 0 8 1.2z"
      />
    </svg>
  );
}

/** Paper's mark, as the boards draw it, in the colour of the text around it. */
export function PaperMark(props: { size: number }) {
  return (
    <svg
      aria-hidden
      width={props.size}
      height={props.size}
      viewBox="0 0 16 16"
      className="shrink-0"
    >
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M5.5 10.5l2-5 3 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** GitHub as the line says it: the repo, or what's missing, in gold when it needs the owner. */
const gitHubWords = (github: WorkspaceConnections["github"]) => {
  switch (github.kind) {
    case "connected":
      return { text: github.repo, needs: false };
    case "signed-out":
      return { text: `${github.repo ?? "GitHub"} · not connected`, needs: true };
    case "not-on-github":
      return { text: "Not on GitHub", needs: false };
  }
};

/**
 * The quiet line under a code workspace's name (#301, #308; Paper, "Code workspace Home"): its
 * GitHub repo and its Paper file, a tap from the Connections sheet. No chips. Its classes are in
 * the stylesheet of the page that shows it (code-home.css), off the first load.
 */
export function ConnectionsLine(props: {
  connections: WorkspaceConnections;
  open: boolean;
  onOpen: () => void;
  /** Its anchor name, for the sheet it opens (place-under.ts). */
  anchor: string;
}) {
  const github = gitHubWords(props.connections.github);
  const { paper } = props.connections;
  return (
    <button
      type="button"
      style={{ anchorName: props.anchor }}
      aria-haspopup="dialog"
      aria-expanded={props.open}
      onClick={props.onOpen}
      className="flex h-5 w-fit max-w-full min-w-0 items-center gap-2 rounded-sm text-meta font-semibold text-foreground/80 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="text-muted-foreground">
        <GitHubMark size={14} />
      </span>
      <span className={classes("truncate", github.needs && "text-warning")}>{github.text}</span>
      <span aria-hidden className="text-placeholder">
        ·
      </span>
      <span className="text-muted-foreground">
        <PaperMark size={14} />
      </span>
      <span className={classes("truncate", paper.kind === "none" && "text-muted-foreground")}>
        {paper.kind === "none" ? "No Paper file" : `Paper · ${paper.name ?? "a file"}`}
      </span>
      <ChevronRight aria-hidden className="size-3.5 shrink-0 text-placeholder" />
    </button>
  );
}
