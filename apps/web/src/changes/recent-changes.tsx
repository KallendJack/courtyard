import { type PlacedLine, placeName, type RecentChange } from "@courtyard/contract";
import { getRouteApi, Link } from "@tanstack/react-router";
import { BookmarkCheck, Pencil, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { NoteRow } from "@/components/note-row";
import { SectionTitle } from "@/components/page";
import { classes } from "@/lib/classes";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import { describeWhen } from "../when.ts";
import { type ContextPlace, loadChanges, undoChange } from "../worker.ts";

const loggedIn = getRouteApi("/_app");

/** A line's place as an entry names it; the owner context's list leaves out "Owner context". */
const placeIn = (about: ContextPlace, line: PlacedLine) => {
  const name = placeName(line);
  return about.kind === "owner" ? name.replace(/^Owner context → /, "") : name;
};

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

/** What an entry says: its label, its line, what that line replaced, and how it's shown. */
const wordsFor = (about: ContextPlace, change: RecentChange) => {
  const [added] = change.added;
  const [removed] = change.removed;
  if (change.undo === "undone") {
    const line = added ?? removed;
    const where = line === undefined ? "" : ` to ${placeIn(about, line)}`;
    return { label: "Undone", line: line?.line, struck: true, note: `saved${where}, then undone` };
  }
  if (change.kind === "edit" && added !== undefined) {
    return { label: `Edited in ${placeIn(about, added)}`, line: added.line, note: "edited by you" };
  }
  if (added !== undefined && removed !== undefined) {
    return { label: `Changed in ${placeIn(about, added)}`, line: added.line, was: removed.line };
  }
  if (added !== undefined) return { label: `Saved to ${placeIn(about, added)}`, line: added.line };
  if (removed !== undefined) {
    return { label: `Removed from ${placeIn(about, removed)}`, line: removed.line, struck: true };
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

/** When it was, and where it came from: its session (with its workspace, on the home page). */
function Meta(props: { about: ContextPlace; change: RecentChange; note?: string }) {
  const { about, change } = props;
  const workspaces = loggedIn.useLoaderData();
  const { session } = change;
  const workspace =
    about.kind === "owner" && session !== undefined && workspaces.kind === "loaded"
      ? workspaces.data.workspaces.find((w) => w.id === session.workspaceId)?.name
      : undefined;
  const parts = [
    describeWhen(change.at),
    ...(props.note === undefined ? [] : [props.note]),
    ...(change.kind === "hand-edit"
      ? [`in ${about.kind === "owner" ? "OWNER.md" : "CONTEXT.md"}`]
      : []),
    ...(workspace === undefined ? [] : [workspace]),
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
function ChangeEntry(props: { about: ContextPlace; change: RecentChange; onUndone: () => void }) {
  const { about, change } = props;
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
      <NoteRow icon={<Pencil />} tall actions={actions} error={undo.error}>
        <p className="font-semibold text-primary-text">Edited by hand</p>
        {pairs.map(({ now, was }) => (
          <HandEditLine
            key={`${now.section}:${now.line}`}
            section={placeIn(about, now)}
            line={now.line}
            {...(was === undefined ? {} : { was: was.line })}
          />
        ))}
        {gone.map((line) => (
          <HandEditLine
            key={`${line.section}:${line.line}`}
            section={placeIn(about, line)}
            line={line.line}
            gone
          />
        ))}
        <Meta about={about} change={change} />
      </NoteRow>
    );
  }

  const words = wordsFor(about, change);
  return (
    <NoteRow
      icon={muted ? <Undo2 /> : change.kind === "edit" ? <Pencil /> : <BookmarkCheck />}
      muted={muted}
      tall
      actions={actions}
      error={undo.error}
    >
      <p>
        <span
          className={classes(
            "font-semibold max-md:block md:mr-1.5",
            muted ? "text-muted-foreground" : "text-primary-text",
          )}
        >
          {words.label}
        </span>
        <span className={words.struck ? "text-muted-foreground line-through" : "text-foreground"}>
          {words.line}
        </span>
        {words.was !== undefined && (
          <span className="text-muted-foreground"> (was {words.was})</span>
        )}
      </p>
      <Meta
        about={about}
        change={change}
        {...(words.note === undefined ? {} : { note: words.note })}
      />
    </NoteRow>
  );
}

/**
 * Recent changes to a workspace's context file or the owner context (ADR 0013), newest first,
 * 30 at a time, with Undo. Loaded once the page is showing, so the page never waits for git. An
 * undo shows as its change marked undone, so undos aren't listed themselves.
 */
export function RecentChanges(props: { about: ContextPlace }) {
  const { about } = props;
  const [changes, setChanges] = useState<RecentChange[]>([]);
  const [more, setMore] = useState<RecentChange["id"] | null>(null);
  const [problem, setProblem] = useState<string>();
  // Pages pass a new object each render: the list loads again only when the place itself changes.
  const place = useRef(about);
  place.current = about;
  const key = about.kind === "owner" ? "owner" : `workspace/${about.id}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names the place `place` holds.
  const load = useCallback(
    async (after?: RecentChange["id"]) => {
      const page = await loadChanges(place.current, after);
      if (page.kind !== "loaded") return describeProblem(page).body;
      const listed = page.data.changes.filter((change) => change.kind !== "undo");
      setChanges((shown) => (after === undefined ? listed : [...shown, ...listed]));
      setMore(page.data.more);
      return undefined;
    },
    [key],
  );
  const showMore = useAction(async () => (more === null ? undefined : load(more)));

  useEffect(() => {
    let current = true;
    void load().then((failed) => {
      if (current) setProblem(failed);
    });
    return () => {
      current = false;
    };
  }, [load]);

  if (changes.length === 0 && problem === undefined) return null;
  return (
    <section aria-label="Recent changes">
      <SectionTitle>Recent changes</SectionTitle>
      <FormError message={problem} />
      <ul aria-label="Recent changes" className="mt-4 space-y-3.5">
        {changes.map((change) => (
          <ChangeEntry
            key={change.id}
            about={about}
            change={change}
            onUndone={() => void load().then(setProblem)}
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
