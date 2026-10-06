import { WORKSPACE_NAME_MAX_LENGTH } from "@courtyard/contract";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import { Page, PageTitle } from "@/components/page";
import { PillButton } from "@/components/pill-button";
import { Input } from "@/components/ui/input";
import { describeProblem } from "../../problems.tsx";
import { addWorkspace } from "../../worker.ts";

export const Route = createFileRoute("/_app/new-workspace")({
  component: NewWorkspace,
});

/** Adds a workspace: the worker makes its folder and starter context file, then it opens. */
function NewWorkspace() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const nameId = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    const workspace = await addWorkspace({ name });
    setSending(false);
    if (workspace.kind !== "loaded") return setError(describeProblem(workspace).body);
    // Every list of workspaces now includes it.
    await router.invalidate();
    await router.navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId: workspace.data.id },
    });
  };

  return (
    <Page>
      <PageTitle>New workspace</PageTitle>
      <p className="mt-2 text-[15px]/[23px] text-muted-foreground">
        One area of your life or one project. It starts with an empty context file for its facts,
        plans and ideas.
      </p>
      <form onSubmit={submit} className="mt-6 max-w-sm space-y-4">
        <div>
          <label htmlFor={nameId} className="text-sm font-medium">
            Name
          </label>
          <Input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={WORKSPACE_NAME_MAX_LENGTH}
            placeholder="Garage gym"
            autoComplete="off"
            required
            // The name is the only thing this page asks for.
            autoFocus
            className="mt-1.5 h-11 bg-field text-base focus-visible:border-primary focus-visible:ring-accent"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive-text">
            {error}
          </p>
        )}
        <PillButton type="submit" disabled={sending}>
          Add workspace
        </PillButton>
      </form>
    </Page>
  );
}
