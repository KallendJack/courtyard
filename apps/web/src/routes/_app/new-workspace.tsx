import { WORKSPACE_NAME_MAX_LENGTH } from "@courtyard/contract";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/button";
import { Page, PageTitle } from "@/components/page";
import { TextField } from "@/components/text-field";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../../problems.tsx";
import { addWorkspace } from "../../worker.ts";

export const Route = createFileRoute("/_app/new-workspace")({
  component: NewWorkspace,
});

/** Adds a workspace: the worker makes its folder and starter context file, then it opens. */
function NewWorkspace() {
  const router = useRouter();
  const [name, setName] = useState("");
  const add = useAction(async () => {
    const workspace = await addWorkspace({ name });
    if (workspace.kind !== "loaded") return describeProblem(workspace).body;
    // Every list of workspaces now includes it.
    await router.invalidate();
    await router.navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId: workspace.data.id },
    });
    return undefined;
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void add.run();
  };

  return (
    <Page>
      <PageTitle>New workspace</PageTitle>
      <p className="mt-2 text-[15px]/[23px] text-muted-foreground">
        One area of your life or one project. It starts with an empty context file for its facts,
        plans and ideas.
      </p>
      <form onSubmit={submit} className="mt-6 max-w-sm space-y-4">
        <TextField
          label="Name"
          error={add.error}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={WORKSPACE_NAME_MAX_LENGTH}
          placeholder="Garage gym"
          autoComplete="off"
          required
          // The name is the only thing this page asks for.
          autoFocus
        />
        <Button type="submit" disabled={add.busy}>
          Add workspace
        </Button>
      </form>
    </Page>
  );
}
