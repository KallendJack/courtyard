import {
  type PlacedLine,
  placeName,
  type RecentChange,
  type RecentChanges as RecentChangesPage,
} from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { createKept, PlaceholderRows, useKept } from "@courtyard/ui/layout/kept.tsx";
import { Link } from "@tanstack/react-router";
import {
  BookmarkCheck,
  FileText,
  Hammer,
  ListChecks,
  Pencil,
  Route,
  Ruler,
  Tag,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import { NoteRow, NoteWords } from "@/components/chat/note-row";
import { EmptyState } from "@/components/layout/notice";
import type { ContextPlace } from "../../api/worker.ts";
import { describeProblem } from "../../components/layout/problems.tsx";
import { loadChanges, undoChange } from "./api.ts";
import { Meta, OPEN, OpenLink, type Whose } from "./entry-parts.tsx";

const placeOf = (workspace: Whose): ContextPlace =>
  workspace === undefined ? { kind: "owner" } : { kind: "workspace", id: workspace };

/** A line's place as an entry names it: the owner context's list leaves out "Owner context". */
const placeIn = (workspace: Whose, line: PlacedLine) =>
  placeName(line, { withinOwnerContext: workspace === undefined });

/**
 * A hand edit's or a tidy's lines: each one put in with the line it replaced in that section, if
 * any, and the lines that went.
 */
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
      <Button
        variant="quiet"
        size="xs"
        onClick={() => void undo.run()}
        busy={undo.busy}
        busyLabel="Undoing…"
      >
        Undo
      </Button>
    ) : undefined;

  if (change.document !== undefined) {
    const { did, name, was, slug } = change.document;
    const label = `${did.charAt(0).toUpperCase()}${did.slice(1)} document`;
    return (
      <NoteRow
        icon={muted ? <Undo2 /> : <FileText />}
        muted={muted}
        tall
        actions={actions}
        error={undo.error}
      >
        <NoteWords
          label={muted ? "Undone" : label}
          line={name}
          was={did === "renamed" ? was : undefined}
          muted={muted}
          struck={did === "deleted"}
        />
        <Meta
          workspace={workspace}
          change={change}
          note={muted ? `${did}, then undone` : undefined}
        />
        {slug !== null && workspace !== undefined && !muted && (
          <OpenLink workspaceId={workspace} kind="document" slug={slug} />
        )}
      </NoteRow>
    );
  }

  // A Thing (ADR 0020), project (#603), Build (#697) or size (#708), by what the change did: a Thing
  // is added, a size recorded, the others started. A Build or size has no page here (#698).
  const file =
    change.thing !== undefined
      ? { ...change.thing, of: "Thing", words: ["Added", "Changed"], icon: <Tag /> }
      : change.project !== undefined
        ? { ...change.project, of: "project", words: ["Started", "Updated"], icon: <Route /> }
        : change.build !== undefined
          ? { ...change.build, of: "Build", words: ["Started", "Updated"], icon: <Hammer /> }
          : change.size && {
              ...change.size,
              slug: null,
              of: "size",
              words: ["Recorded", "Corrected"],
              icon: <Ruler />,
            };
  if (file !== undefined) {
    const { did, name, slug, of } = file;
    const thing = of === "Thing";
    const words = { added: file.words[0], changed: file.words[1] };
    const open = slug !== null && workspace !== undefined && !muted;
    return (
      <NoteRow
        icon={muted ? <Undo2 /> : file.icon}
        muted={muted}
        tall
        actions={actions}
        error={undo.error}
      >
        <NoteWords
          label={muted ? "Undone" : `${did === "removed" ? "Removed" : words[did]} ${of}`}
          line={name}
          muted={muted}
          struck={did === "removed"}
        />
        <Meta
          workspace={workspace}
          change={change}
          note={muted ? `${did}, then undone` : undefined}
        />
        {open && thing && <OpenLink workspaceId={workspace} kind="thing" slug={slug} />}
        {open && of === "project" && (
          <Link
            to="/workspaces/$workspaceId"
            params={{ workspaceId: workspace }}
            hash={`project/${slug}`}
            className={OPEN}
          >
            Open
          </Link>
        )}
      </NoteRow>
    );
  }

  // A move the owner ticked in the move review (#603), by what moved where.
  if (change.move !== undefined) {
    return (
      <NoteRow
        icon={muted ? <Undo2 /> : <ListChecks />}
        muted={muted}
        tall
        actions={actions}
        error={undo.error}
      >
        <NoteWords label={muted ? "Undone" : "Moved"} line={change.move.title} muted={muted} />
        <Meta
          workspace={workspace}
          change={change}
          note={muted ? "moved, then undone" : undefined}
        />
      </NoteRow>
    );
  }

  if (change.kind === "hand-edit" || change.kind === "tidy") {
    const { pairs, gone } = pairedLines(change);
    const tidy = change.kind === "tidy";
    return (
      <NoteRow
        icon={muted ? <Undo2 /> : tidy ? <ListChecks /> : <Pencil />}
        muted={muted}
        tall
        actions={actions}
        error={undo.error}
      >
        <NoteWords label={muted ? "Undone" : tidy ? "Tidied" : "Edited by hand"} muted={muted} />
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
        <Meta
          workspace={workspace}
          change={change}
          note={muted ? "undone" : tidy ? "ticked by you" : undefined}
        />
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

/** The changes shown, undos left out, and where the next page starts, if there's one. */
type Listed = {
  readonly changes: readonly RecentChange[];
  readonly more: RecentChange["id"] | null;
};

/** Each place's changes as last shown, for the tab's lifetime: the owner context's by "". */
const KEPT_CHANGES = createKept<Listed>();

/** A page of changes, with the undos left out: an undo shows as its change marked undone. */
const listedOf = (page: RecentChangesPage) => ({
  changes: page.changes.filter((change) => change.kind !== "undo"),
  more: page.more,
});

/**
 * Recent changes to a workspace's context file or the owner context (ADR 0013), newest first,
 * 30 at a time, with Undo, under its page's title. Loaded once the page is showing, so the page
 * never waits for git: faint rows keep the list's place the first time, and coming back shows the
 * list as last shown at once, asked for again quietly. An undo shows as its change marked undone,
 * so undos aren't listed themselves. Its page gives it a key per place, so a new place starts it
 * afresh.
 */
export function RecentChanges(props: { workspace: Whose }) {
  const { workspace } = props;
  const key = workspace ?? "";
  const [problem, setProblem] = useState<string>();
  const listed = useKept(KEPT_CHANGES, {
    key,
    load: async () => {
      const page = await loadChanges(placeOf(workspace));
      setProblem(page.kind === "loaded" ? undefined : describeProblem(page).body);
      return page.kind === "loaded" ? listedOf(page.data) : undefined;
    },
  });
  const changes = listed?.changes ?? [];
  const more = listed?.more ?? null;

  const showMore = useAction(async () => {
    if (more === null) return undefined;
    const page = await loadChanges(placeOf(workspace), more);
    if (page.kind !== "loaded") return describeProblem(page).body;
    const next = listedOf(page.data);
    KEPT_CHANGES.set(key, { changes: [...changes, ...next.changes], more: next.more });
    return undefined;
  });

  /** Shows an undone change as undone, where it is, with every page shown kept. */
  const markUndone = (id: RecentChange["id"]) =>
    KEPT_CHANGES.set(key, {
      changes: changes.map((change) => (change.id === id ? { ...change, undo: "undone" } : change)),
      more,
    });

  return (
    <section aria-label="Recent changes">
      <FormError message={problem} />
      {listed === undefined && problem === undefined && <PlaceholderRows count={3} size="tall" />}
      {listed !== undefined && changes.length === 0 && problem === undefined && (
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
            busy={showMore.busy}
            busyLabel="Loading more…"
          >
            Show more
          </Button>
          <FormError message={showMore.error} />
        </div>
      )}
    </section>
  );
}
