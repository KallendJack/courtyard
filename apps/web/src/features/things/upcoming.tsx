import type { ChangeId, ThingSummary, WorkspaceId } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { useRouter } from "@tanstack/react-router";
import { Check, Search } from "lucide-react";
import { useState } from "react";
import { ButtonLink } from "@/components/buttons/button-link";
import { WebLink } from "@/components/buttons/web-link";
import { describeProblem } from "../../components/layout/problems.tsx";
import { JustDeleted } from "../changes/just-deleted.tsx";
import { fitUpcoming } from "./api.ts";
import { boughtInWords } from "./words.ts";

/**
 * A Thing's card's top (#602; Paper, "Tablet · Part card: pedals with upcoming, Find a replacement
 * (#602)"): with an upcoming one, what's fitted beside what's coming (its price, why, and its
 * shop's page); then Find a replacement, and "<upcoming> fitted", which swaps it in, with Undo.
 */
export function NowAndUpcoming(props: { workspaceId: WorkspaceId; thing: ThingSummary }) {
  const { workspaceId, thing } = props;
  const router = useRouter();
  const { upcoming } = thing;
  /** The upcoming one just fitted, and the change that fitted it, for Undo. */
  const [fitted, setFitted] = useState<{ name: string; change: ChangeId | undefined }>();
  const fit = useAction(async () => {
    if (upcoming === undefined) return undefined;
    const done = await fitUpcoming(workspaceId, thing.slug);
    if (done.kind !== "loaded") return describeProblem(done).body;
    setFitted({ name: upcoming.name, change: done.data.change ?? undefined });
    await router.invalidate();
    return undefined;
  });
  const now = [
    thing.size,
    thing.condition,
    thing.bought === undefined ? undefined : `bought ${boughtInWords(thing.bought)}`,
  ].filter((said) => said !== undefined);

  return (
    <div className="flex flex-col gap-3.5">
      {upcoming !== undefined && (
        <div className="flex flex-col gap-3 md:flex-row">
          <section
            aria-label="Fitted"
            className="flex min-w-0 flex-1 basis-0 flex-col gap-1 rounded-card border bg-surface p-3.5"
          >
            <CapsLabel tone="muted">{thing.partOf === undefined ? "Now" : "Fitted"}</CapsLabel>
            <p className="text-answer/5.5 font-bold text-foreground">{thing.brand ?? thing.name}</p>
            {now.length > 0 && (
              <p className="text-meta font-medium text-foreground/75">{now.join(" · ")}</p>
            )}
          </section>
          <section
            aria-label="Upcoming"
            className="flex min-w-0 flex-1 basis-0 flex-col gap-1 rounded-card border border-primary/35 bg-primary/12 p-3.5"
          >
            <CapsLabel tone="primary">Upcoming</CapsLabel>
            <p className="text-answer/5.5 font-bold text-foreground">
              {[upcoming.name, upcoming.price].filter((said) => said !== undefined).join(" · ")}
            </p>
            {(upcoming.why !== undefined || upcoming.link !== undefined) && (
              <p className="text-meta font-medium text-primary-text">
                {upcoming.why}
                {upcoming.why !== undefined && upcoming.link !== undefined && " · "}
                {upcoming.link !== undefined && (
                  <WebLink href={upcoming.link}>{`${upcoming.shop ?? "Shop"} ›`}</WebLink>
                )}
              </p>
            )}
          </section>
        </div>
      )}
      {thing.status !== "want" && (
        <div className="flex flex-wrap gap-2.5">
          <ButtonLink
            size="lg"
            to="/workspaces/$workspaceId/things/$slug"
            params={{ workspaceId, slug: thing.slug }}
            search={{ replace: true }}
          >
            <Search aria-hidden />
            Find a replacement
          </ButtonLink>
          {upcoming !== undefined && (
            <Button
              variant="outline"
              size="lg"
              onClick={() => void fit.run()}
              busy={fit.busy}
              busyLabel="Fitting…"
            >
              {upcoming.name} fitted
            </Button>
          )}
        </div>
      )}
      <FormError message={fit.error} />
      {fitted !== undefined && (
        <JustDeleted
          name={fitted.name}
          change={fitted.change}
          did={{ label: "Fitted", icon: <Check /> }}
          onUndone={async () => {
            setFitted(undefined);
            await router.invalidate();
          }}
        />
      )}
    </div>
  );
}
