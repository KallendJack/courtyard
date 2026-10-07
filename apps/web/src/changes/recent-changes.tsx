import {
  type PlacedLine,
  placeName,
  type RecentChange,
  type WorkspaceId,
} from "@courtyard/contract";
import { getRouteApi, Link } from "@tanstack/react-router";
import { BookmarkCheck, Pencil, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { NoteRow, NoteWords } from "@/components/note-row";
import { EmptyState } from "@/components/notice";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import { describeWhen } from "../when.ts";
import { type ContextPlace, loadChanges, undoChange } from "../worker.ts";

const loggedIn = getRouteApi("/_app");

/** Whose changes these are: a workspace's, or the owner context's for `undefined`. */
type Whose = WorkspaceId | undefined;

const placeOf = (workspace: Whose): ContextPlace =>
  workspace === undefined ? { kind: "owner" } : { kind: "workspace", id: workspace };

/** A line's place as an entry names it: the owner context's list leaves out "Owner context". */
const placeIn = (workspace: Whose, line: PlacedLine) =>
  placeName(line, { withinOwnerContext: workspace === undefined });

/** A hand edit's lines: each one put in with the line it replaced in that section, if any. */
const pairedLines = (change: RecentChange) => {
  const removed = [...change.removed];
  const pairs = change.added.map((now) => {
    const index = removed.findIndex((was) => was.section === now.section);
    const was = index === -1 ? undefined : removed.splice(index, 1)[0];
    return { now, was };
  });
  return { pairs, gone: removed };
};

/** What a save or an edit says: its label, its line, what it replaced, and a note on it. */
const wordsFor = (workspace: Whose, change: RecentChange) => {
  const [added] = change.added;
  const [removed] = change.removed;
  if (change.undo === "undone") {
    const what =
      added === undefined
        ? `removed from ${removed === undefined ? "" : placeIn(workspace, removed)}`
        : `saved to ${placeIn(workspace, added)}`;
    return { label: "Undone", line: (added ?? removed)?.line, note: `${what}, then undone` };
  }
  if (change.kind === "edit" && added !== undefined) {
    return {
      label: `Edited in ${placeIn(workspace, added)}`,
      line: added.line,
      was: removed?.line,
      note: "edited by you",
    };
  }
  if (added !== undefined && removed !== undefined) {
    return {
      label: `Changed in ${placeIn(workspace, added)}`,
      line: added.line,
      was: removed.line,
    };
  }
  if (added !== undefined)
    return { label: `Saved to ${placeIn(workspace, added)}`, line: added.line };
  if (removed !== undefined) {
    return {
      label: `Removed from ${placeIn(workspace, removed)}`,
      line: removed.line,
      struck: true,
    };
  }
  return { label: "Changed" };
};

/** One line of a hand edit: its section, the line, and what it replaced or that it went. */
function HandEditLine(props: { section: string; line: string; was?: string; gone?: boolean }) {
  return (
    <p>
      <span className="mr-1.5 text-muted-foreground">{props.section}:</span>
      <span className={props.gone ? "text-muted-foreground line-through" : "text-foreground"}>
        {props.line}
      </span>
      {props.was !== undefined && <span className="text-muted-foreground"> (was {props.was})</span>}
    </p>
  );
}

/** When it was, and where it came from: its session (with its workspace, in the owner's list). */
function Meta(props: { workspace: Whose; change: RecentChange; note?: string | undefined }) {
  const { workspace, change } = props;
  const workspaces = loggedIn.useLoaderData();
  const { session } = change;
  const from =
    workspace === undefined && session !== undefined && workspaces.kind === "loaded"
      ? workspaces.data.workspaces.find((w) => w.id === session.workspaceId)?.name
      : undefined;
  const parts = [
    describeWhen(change.at),
    ...(props.note === undefined ? [] : [props.note]),
    ...(change.kind === "hand-edit"
      ? [`in ${workspace === undefined ? "OWNER.md" : "CONTEXT.md"}`]
      : []),
    ...(from === undefined ? [] : [from]),
  ];
  return (
    <p className="text-[13px]/5 text-muted-foreground">
      {parts.join(" · ")}
      {session !== undefined && (
        <>
          {" · "}
          <Link
            to="/workspaces/$workspaceId/sessions/$sessionId"
            params={{ workspaceId: session.workspaceId, sessionId: session.id }}
            className="text-foreground underline"
          >
            {session.title}
          </Link>
        </>
      )}
    </p>
  );
}

/** One entry: the change as a note, when and where it came from, and Undo while it can be. */
function ChangeEntry(props: { workspace: Whose; change: RecentChange; onUndone: () => void }) {
  const { workspace, change } = props;
  const undo = useAction(async () => {
    const undone = await undoChange(change.id);
    if (undone.kind !== "loaded") return describeProblem(undone).body;
    props.onUndone();
    return undefined;
  });
  const muted = change.undo === "undone";
  const actions =
    change.undo === "available" ? (
      <Button variant="quiet" size="xs" onClick={() => void undo.run()} disabled={undo.busy}>
        Undo
      </Button>
    ) : undefined;

  if (change.kind === "hand-edit") {
    const { pairs, gone } = pairedLines(change);
    return (
      <NoteRow
        icon={muted ? <Undo2 /> : <Pencil />}
        muted={muted}
        tall
        actions={actions}
        error={undo.error}
      >
        <NoteWords label={muted ? "Undone" : "Edited by hand"} muted={muted} />
        {pairs.map(({ now, was }) => (
          <HandEditLine
            key={`${now.section}:${now.line}`}
            section={placeIn(workspace, now)}
            line={now.line}
            {...(was === undefined ? {} : { was: was.line })}
          />
        ))}
        {gone.map((line) => (
          <HandEditLine
            key={`${line.section}:${line.line}`}
            section={placeIn(workspace, line)}
            line={line.line}
            gone
          />
        ))}
        <Meta workspace={workspace} change={change} note={muted ? "undone" : undefined} />
      </NoteRow>
    );
  }

  const words = wordsFor(workspace, change);
  return (
    <NoteRow
      icon={muted ? <Undo2 /> : change.kind === "edit" ? <Pencil /> : <BookmarkCheck />}
      muted={muted}
      tall
      actions={actions}
      error={undo.error}
    >
      <NoteWords
        label={words.label}
        line={words.line}
        was={words.was}
        muted={muted}
        struck={words.struck === true}
      />
      <Meta workspace={workspace} change={change} note={words.note} />
    </NoteRow>
  );
}

/**
 * Recent changes to a workspace's context file or the owner context (ADR 0013), newest first,
 * 30 at a time, with Undo, under its page's title. Loaded once the page is showing, so the page
 * never waits for git. An undo shows as its change marked undone, so undos aren't listed
 * themselves. Its page gives it a key per place, so a new place starts it afresh.
 */
export function RecentChanges(props: { workspace: Whose }) {
  const { workspace } = props;
  const [changes, setChanges] = useState<RecentChange[]>([]);
  const [more, setMore] = useState<RecentChange["id"] | null>(null);
  const [problem, setProblem] = useState<string>();
  const [loaded, setLoaded] = useState(false);

  const showMore = useAction(async () => {
    if (more === null) return undefined;
    const page = await loadChanges(placeOf(workspace), more);
    if (page.kind !== "loaded") return describeProblem(page).body;
    const listed = page.data.changes.filter((change) => change.kind !== "undo");
    setChanges((shown) => [...shown, ...listed]);
    setMore(page.data.more);
    return undefined;
  });

  useEffect(() => {
    let current = true;
    void loadChanges(placeOf(workspace)).then((page) => {
      if (!current) return;
      if (page.kind === "loaded") {
        setChanges(page.data.changes.filter((change) => change.kind !== "undo"));
        setMore(page.data.more);
      } else {
        setProblem(describeProblem(page).body);
      }
      setLoaded(true);
    });
    return () => {
      current = false;
    };
  }, [workspace]);

  /** Shows an undone change as undone, where it is, with every page shown kept. */
  const markUndone = (id: RecentChange["id"]) =>
    setChanges((shown) =>
      shown.map((change) => (change.id === id ? { ...change, undo: "undone" } : change)),
    );

  return (
    <section aria-label="Recent changes">
      <FormError message={problem} />
      {loaded && changes.length === 0 && problem === undefined && (
        <EmptyState>No changes yet.</EmptyState>
      )}
      <ul aria-label="Recent changes" className="space-y-3.5">
        {changes.map((change) => (
          <ChangeEntry
            key={change.id}
            workspace={workspace}
            change={change}
            onUndone={() => markUndone(change.id)}
          />
        ))}
      </ul>
      {more !== null && (
        <div className="mt-5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void showMore.run()}
            disabled={showMore.busy}
          >
            Show more
          </Button>
          <FormError message={showMore.error} />
        </div>
      )}
    </section>
  );
}
