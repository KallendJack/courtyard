import type { FirstMessage, ProviderList, ThingSummary, WorkspaceId } from "@courtyard/contract";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { BackLink } from "@/components/buttons/back-link";
import { FormError } from "@/components/forms/form-error";
import { SegmentedChoice } from "@/components/forms/segmented-choice";
import { Page, PageTitle } from "@/components/layout/page";
import { useAction } from "@/hooks/use-action";
import { describeProblem } from "../../components/layout/problems.tsx";
import { Composer } from "../sessions/composer/composer.tsx";
import { startSession } from "../sessions/composer/messages.ts";
import { OwnerWords } from "../sessions/turns/turn-view.tsx";
import { budgetChoices, replacementMessage } from "./words.ts";

/**
 * Find a replacement (#602, ADR 0032; Paper, "Tablet · Find a replacement: budget tapped, options
 * with Pick (#602)"): the session it starts, filled in for the owner to see before it goes, "Replace
 * my pedals (Wellgo alloy flats).", with budgets to tap, each starting it with "Budget: …" added;
 * or the box, to talk or type a budget of their own, which goes after the same words. Opening it
 * never opens the keyboard. The model answers
 * with the options side by side (an `options` block), a Pick making one the part's upcoming one.
 */
export function FindReplacement(props: {
  workspaceId: WorkspaceId;
  thing: ThingSummary;
  providers: ProviderList["providers"] | undefined;
}) {
  const { workspaceId, thing } = props;
  const navigate = useNavigate();
  const message = replacementMessage(thing);
  const [budget, setBudget] = useState("");
  /** Starts the session with the message as the owner sees it, then opens it. */
  const start = async (first: FirstMessage, files: readonly File[]) => {
    const session = await startSession({ workspaceId, message: first, files });
    if (session.kind !== "loaded") return describeProblem(session).body;
    await navigate({
      to: "/workspaces/$workspaceId/sessions/$sessionId",
      params: { workspaceId, sessionId: session.data.id },
    });
    return undefined;
  };
  const tapped = useAction(async (choice: string) => {
    setBudget(choice);
    const failed = await start({ text: `${message} Budget: ${choice.toLowerCase()}` }, []);
    if (failed !== undefined) setBudget("");
    return failed;
  });

  const header = (
    <PageTitle above={<BackLink workspaceId={workspaceId} thing={thing} />}>
      Find a replacement
    </PageTitle>
  );
  const footer =
    props.providers === undefined ? undefined : (
      <Composer
        providers={props.providers}
        placeholder="Or talk or type a budget…"
        submitLabel="Start"
        send={(sent, files) => start({ ...sent, text: `${message} Budget: ${sent.text}` }, files)}
      />
    );

  return (
    <Page header={header} footer={footer}>
      <div className="mt-5 flex flex-col items-end gap-2.5">
        <OwnerWords>
          {budget === "" ? message : `${message} Budget: ${budget.toLowerCase()}`}
        </OwnerWords>
        <SegmentedChoice
          label="Budget"
          look="apart"
          options={budgetChoices(thing).map((choice) => ({ value: choice, label: choice }))}
          value={budget}
          onChange={(choice) => {
            if (!tapped.busy) void tapped.run(choice);
          }}
        />
        <FormError message={tapped.error} />
      </div>
    </Page>
  );
}
