import {
  type PlacedLine,
  placeName,
  type TidyChange,
  type TidyProposal,
  type WorkspaceId,
} from "@courtyard/contract";
import { useNavigate } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { NoteRow } from "@/components/note-row";
import { EmptyState } from "@/components/notice";
import { TickBox } from "@/components/tick-box";
import { classes } from "@/lib/classes";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import { firstSavingModel } from "../sessions/models.ts";
import { loadProviders } from "../worker.ts";
import { proposeTidy, saveTidy } from "./api.ts";

/** Whose file is tidied: a workspace's, or the owner context for `undefined`. */
type Whose = WorkspaceId | undefined;

/** Where a tidy is, from asking for it to having it. */
type Asking =
  | { readonly kind: "asking" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "proposed"; readonly proposal: TidyProposal };

/** Asks the first model on offer that saves to context for a tidy of the file. */
const askForTidy = async (workspace: Whose): Promise<Asking> => {
  const providers = await loadProviders();
  if (providers.kind !== "loaded")
    return { kind: "failed", message: describeProblem(providers).body };
  const model = firstSavingModel(providers.data.providers);
  if (model === undefined) {
    return {
      kind: "failed",
      message: "No model that saves to context is available. Check the providers' settings.",
    };
  }
  const about =
    workspace === undefined
      ? { kind: "owner" as const }
      : { kind: "workspace" as const, id: workspace };
  const proposal = await proposeTidy(about, { model });
  return proposal.kind === "loaded"
    ? { kind: "proposed", proposal: proposal.data }
    : { kind: "failed", message: describeProblem(proposal).body };
};

const VERB: Record<TidyChange["kind"], string> = {
  merge: "Merge in",
  remove: "Remove from",
  shorten: "Shorten in",
};

const count = (n: number) => n.toLocaleString("en-GB");

/** One proposed change: its tick box, what it does where, the lines it takes out and puts in. */
function ProposedChange(props: {
  workspace: Whose;
  change: TidyChange;
  ticked: boolean;
  onTick: (ticked: boolean) => void;
}) {
  const { change, ticked } = props;
  const id = useId();
  const [first] = change.lines;
  const where = (line: PlacedLine) =>
    placeName(line, { withinOwnerContext: props.workspace === undefined });
  return (
    <NoteRow
      icon={{ control: <TickBox id={id} checked={ticked} onChange={props.onTick} /> }}
      muted={!ticked}
      tall
    >
      <label htmlFor={id} className="block cursor-pointer">
        <span
          className={classes(
            "block font-semibold",
            ticked ? "text-primary-text" : "text-muted-foreground",
          )}
        >
          {VERB[change.kind]} {first === undefined ? "" : where(first)}
        </span>
        {change.lines.map((line) => (
          <span
            key={`${line.section}:${line.line}`}
            className={classes("block text-muted-foreground", ticked && "line-through")}
          >
            {line.line}
          </span>
        ))}
        {ticked && change.text !== undefined && (
          <span className="block text-foreground">{change.text}</span>
        )}
        {change.why !== undefined && (
          <span className="block text-[13px]/5 text-muted-foreground italic">{change.why}</span>
        )}
      </label>
    </NoteRow>
  );
}

/**
 * Tidy (docs/ai-conduct.md, Tidying): asks a model for changes that make a workspace's context
 * file or the owner context shorter, shows each one ticked, and saves the ticked ones as one
 * change. Afterwards it goes to Recent changes, where the tidy can be undone. Asking again starts
 * afresh.
 */
export function TidyReview(props: { workspace: Whose; name: string }) {
  const [attempt, setAttempt] = useState(0);
  return <OneTidy key={attempt} {...props} again={() => setAttempt((n) => n + 1)} />;
}

/** One tidy: asked for once, then reviewed and saved. */
function OneTidy(props: { workspace: Whose; name: string; again: () => void }) {
  const { workspace, again } = props;
  const navigate = useNavigate();
  const [asking, setAsking] = useState<Asking>({ kind: "asking" });
  const [unticked, setUnticked] = useState<ReadonlySet<number>>(new Set());
  /** The tidy can't be saved any more: the file changed, or the worker forgot it. */
  const [stale, setStale] = useState(false);

  useEffect(() => {
    // Only the latest ask's answer counts, so an earlier one finishing late never replaces it.
    let current = true;
    void askForTidy(workspace).then((asked) => {
      if (current) setAsking(asked);
    });
    return () => {
      current = false;
    };
  }, [workspace]);

  const back = () =>
    workspace === undefined
      ? navigate({ to: "/" })
      : navigate({ to: "/workspaces/$workspaceId", params: { workspaceId: workspace } });

  const save = useAction(async (proposal: TidyProposal) => {
    const keep = proposal.changes.flatMap((_, index) => (unticked.has(index) ? [] : [index]));
    const saved = await saveTidy(proposal.id, { keep });
    if (saved.kind === "not-found" || (saved.kind === "failed" && saved.status === 409)) {
      setStale(true);
    }
    if (saved.kind === "not-found") {
      return "This tidy has gone, perhaps because the worker restarted. Tidy again.";
    }
    if (saved.kind !== "loaded") return describeProblem(saved).body;
    await navigate({ to: "/changes", search: workspace === undefined ? {} : { workspace } });
    return undefined;
  });

  if (asking.kind === "asking") {
    return (
      <p role="status" className="flex items-center gap-2.5 text-[15px]/[23px]">
        <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-primary-text" />
        Reading {props.name} for lines to merge, remove or shorten…
      </p>
    );
  }
  if (asking.kind === "failed") {
    return (
      <div className="space-y-3">
        <FormError message={asking.message} />
        <Button variant="outline" onClick={again}>
          Try again
        </Button>
      </div>
    );
  }

  const { proposal } = asking;
  if (proposal.changes.length === 0) {
    return (
      <EmptyState>Nothing worth changing: every line is short, current and said once.</EmptyState>
    );
  }
  const ticked = proposal.changes.length - unticked.size;
  const after =
    proposal.characters -
    proposal.changes.reduce(
      (sum, change, index) => (unticked.has(index) ? sum : sum + change.shortensBy),
      0,
    );
  const tick = (index: number, on: boolean) => {
    const next = new Set(unticked);
    if (on) next.delete(index);
    else next.add(index);
    setUnticked(next);
  };

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {proposal.changes.length} {proposal.changes.length === 1 ? "change" : "changes"} proposed ·{" "}
        {count(proposal.characters)} characters now, {count(after)} with the ticked ones
      </p>
      <ul aria-label="Proposed changes" className="mt-6 space-y-4">
        {proposal.changes.map((change, index) => (
          <ProposedChange
            // A proposal's changes never move, so their place in it is their key.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            key={index}
            workspace={workspace}
            change={change}
            ticked={!unticked.has(index)}
            onTick={(on) => tick(index, on)}
          />
        ))}
      </ul>
      <div className="sticky bottom-0 -mx-4 mt-6 border-t bg-card px-4 pt-3 pb-6 md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
        <div className="flex gap-2">
          {stale ? (
            <Button size="lg" onClick={again}>
              Tidy again
            </Button>
          ) : (
            <Button
              size="lg"
              onClick={() => void save.run(proposal)}
              disabled={save.busy || ticked === 0}
            >
              Save {ticked} {ticked === 1 ? "change" : "changes"}
            </Button>
          )}
          <Button size="lg" variant="outline" onClick={() => void back()}>
            Cancel
          </Button>
        </div>
        {save.error !== undefined && (
          <div className="mt-2">
            <FormError message={save.error} />
          </div>
        )}
      </div>
    </>
  );
}
