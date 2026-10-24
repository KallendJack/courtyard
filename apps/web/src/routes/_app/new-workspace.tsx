import { PageTitle } from "@courtyard/ui/layout/page.tsx";
import { createFileRoute } from "@tanstack/react-router";
import { NewWorkspaceForm } from "../../features/new-workspace/new-workspace-form.tsx";

export const Route = createFileRoute("/_app/new-workspace")({
  component: NewWorkspace,
});

/**
 * Adds a workspace: a planning one, whose folder and starter context file the worker makes, its
 * intro line what it's for when the owner says; or a code one on a repo picked from the owner's
 * GitHub (#258). Then it opens.
 */
function NewWorkspace() {
  return (
    <NewWorkspaceForm
      header={
        <>
          <PageTitle>New workspace</PageTitle>
          <p className="mt-2 text-body text-muted-foreground">
            Say what it's for. For code, pick a repo or start a new one.
          </p>
        </>
      }
    />
  );
}
