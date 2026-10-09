import { DOCUMENT_NAME_MAX_LENGTH, type DocumentDetail, WorkspaceId } from "@courtyard/contract";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { Page, PageTitle } from "@/components/page";
import { RenameForm } from "@/components/rename-form";
import { useAction } from "@/lib/use-action";
import { deleteDocument, renameDocument } from "../../documents/api.ts";
import { describeProblem, Problem } from "../../problems.tsx";
import { Answer } from "../../sessions/answer.tsx";
import { describeWhen } from "../../when.ts";

export const Route = createFileRoute("/_app/workspaces/$workspaceId/documents/$slug")({
  // The loader stays in the first load, so its schemas load with the page.
  loader: async ({ params }) => {
    const { loadDocument } = await import("../../documents/api.ts");
    return { document: await loadDocument(params) };
  },
  component: DocumentPage,
});

function DocumentPage() {
  const { document } = Route.useLoaderData();
  const params = Route.useParams();
  const workspaceId = WorkspaceId.safeParse(params.workspaceId);
  if (document.kind === "not-found" || !workspaceId.success) {
    return (
      <Page>
        <PageTitle>No such document</PageTitle>
        <p className="mt-3 text-muted-foreground">
          It may have been renamed or deleted.{" "}
          {workspaceId.success && (
            <Link
              to="/workspaces/$workspaceId"
              params={{ workspaceId: workspaceId.data }}
              className="text-foreground underline"
            >
              Back to its workspace
            </Link>
          )}
        </p>
      </Page>
    );
  }
  if (document.kind !== "loaded") return <Problem result={document} />;
  return (
    <Document key={document.data.document.slug} workspaceId={workspaceId.data} {...document.data} />
  );
}

/** "Today, 18:42" or "Yesterday" as it reads after "Updated"; a date stays as it is. */
const inASentence = (when: string) =>
  when.replace(/^(Today|Yesterday)/, (word) => word.toLowerCase());

/**
 * A document's page (ADR 0020): its name, when it changed and its file, with Rename and Delete,
 * then its text drawn the way an answer is, so its tables, charts and diagrams show. No editor:
 * a model changes it in a session, or the owner edits the file by hand.
 */
function Document(props: DocumentDetail & { workspaceId: WorkspaceId }) {
  const { document, body, workspaceId } = props;
  const [renaming, setRenaming] = useState(false);
  const navigate = useNavigate();
  const router = useRouter();
  const remove = useAction(async () => {
    const deleted = await deleteDocument(workspaceId, document.slug);
    if (deleted.kind !== "loaded") return describeProblem(deleted).body;
    // Deleted at once: the workspace page says so, with Undo.
    await navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId },
      search: {
        ...(deleted.data.change === null ? {} : { deleted: deleted.data.change }),
        name: document.name,
      },
    });
    return undefined;
  });
  const above = <BackLink workspaceId={workspaceId} within="Documents" />;

  return (
    <Page>
      {renaming ? (
        <div className="flex flex-col gap-2">
          {above}
          <RenameForm
            label="Document name"
            value={document.name}
            maxLength={DOCUMENT_NAME_MAX_LENGTH}
            large
            save={async (name) => {
              const renamed = await renameDocument(workspaceId, document.slug, { name });
              if (renamed.kind !== "loaded") return describeProblem(renamed).body;
              // Its file's name follows its name, and so does its address.
              await navigate({
                to: "/workspaces/$workspaceId/documents/$slug",
                params: { workspaceId, slug: renamed.data.document.slug },
                replace: true,
              });
              await router.invalidate();
              return undefined;
            }}
            onDone={() => setRenaming(false)}
          />
        </div>
      ) : (
        <PageTitle above={above}>{document.name}</PageTitle>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-b pb-5">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground wrap-anywhere">
          Updated {inASentence(describeWhen(document.updatedAt))} · {document.path}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setRenaming(true)}>
            Rename
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void remove.run()}
            disabled={remove.busy}
          >
            Delete
          </Button>
        </div>
      </div>
      <FormError message={remove.error} />
      <div className="mt-6">
        {body === "" ? (
          <p className="text-muted-foreground">Nothing below its name yet.</p>
        ) : (
          <Answer text={body} running={false} replayed={body.length} />
        )}
      </div>
    </Page>
  );
}
