import type { PinnedPart, ThingSummary, WorkspaceId } from "@courtyard/contract";
import { X } from "lucide-react";
import { Button, IconButton } from "@/components/buttons/button";
import { ButtonLink } from "@/components/buttons/button-link";
import { FormError } from "@/components/forms/form-error";
import { CapsLabel } from "@/components/layout/caps-label";
import { CardDialog } from "@/components/layout/card-dialog";
import { useAction } from "@/hooks/use-action";
import { describeProblem } from "../../components/layout/problems.tsx";
import { boughtInWords } from "../things/words.ts";
import { markThing } from "./api.ts";

/** What a part needs, in a few words: its next step, else that it's to get or to replace. */
export const needsLine = (part: Pick<PinnedPart, "needs" | "status">) =>
  part.needs ?? (part.status === "want" ? "To get" : part.status === "replace" ? "To replace" : "");

/**
 * A part's card, opened from its pin or its row (#481; Paper, "Desktop · Home: the bike, a part's
 * card open"): what it needs, then its details (the background Home leaves out, #220), and Add to
 * wanted for one the owner has, Done it for one that needs something, and its whole card. Beside
 * the view where there's room, else over the page.
 */
export function PartCard(props: {
  workspaceId: WorkspaceId;
  part: PinnedPart;
  /** The part as the Things list has it, for its details. */
  thing: ThingSummary | undefined;
  /** The Thing it's part of, the view's title. */
  of: string;
  beside: boolean;
  onClose: () => void;
  /** Once Done it or Add to wanted is saved: Home loads again. */
  onMarked: (mark: "done" | "wanted") => Promise<void>;
}) {
  const { part, thing } = props;
  const mark = useAction(async (how: "done" | "wanted") => {
    const marked = await markThing(props.workspaceId, part.thing, how);
    if (marked.kind !== "loaded") return describeProblem(marked).body;
    await props.onMarked(how);
    return undefined;
  });
  const details = [
    thing?.brand,
    thing?.size,
    thing?.condition,
    thing?.bought === undefined ? undefined : `bought ${boughtInWords(thing.bought)}`,
    thing?.where,
  ].filter((detail) => detail !== undefined);
  const needs = needsLine(part);

  const body = (
    <div className="flex min-h-0 grow flex-col gap-4">
      {needs !== "" && (
        <div className="flex flex-col gap-1">
          <CapsLabel tone="warning">Needs</CapsLabel>
          <p className="text-interface font-semibold">{needs}</p>
        </div>
      )}
      {details.length > 0 && (
        <div className="flex flex-col gap-1">
          <CapsLabel tone="muted">Details</CapsLabel>
          <p className="text-meta text-muted-foreground">{details.join(" · ")}</p>
        </div>
      )}
      <div className="grow" />
      <div className="flex flex-wrap gap-2">
        {part.status === "have" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void mark.run("wanted")}
            busy={mark.running?.[0] === "wanted"}
            busyLabel="Adding…"
          >
            Add to wanted
          </Button>
        )}
        {part.flagged && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void mark.run("done")}
            busy={mark.running?.[0] === "done"}
            busyLabel="Saving…"
          >
            Done it
          </Button>
        )}
        <ButtonLink
          variant="quiet"
          size="sm"
          to="/workspaces/$workspaceId/things/$slug"
          params={{ workspaceId: props.workspaceId, slug: part.thing }}
        >
          Its card
        </ButtonLink>
      </div>
      <FormError message={mark.error} />
    </div>
  );

  if (!props.beside) {
    return (
      <CardDialog title={part.name} note={`Part of ${props.of}`} open onClose={props.onClose}>
        {body}
      </CardDialog>
    );
  }
  return (
    <section
      aria-label={`${part.name}'s card`}
      className="flex w-60 shrink-0 flex-col gap-3 rounded-card border bg-card p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="display-title text-sheet-title">{part.name}</h3>
        <IconButton label="Close" size="sm" icon={<X />} onClick={props.onClose} />
      </div>
      {body}
    </section>
  );
}
