import type { ChangeId, DocumentSummary, WorkspaceId } from "@courtyard/contract";
import { Link } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { LIST_ROW, SectionTitle } from "@/components/page";
import { JustDeleted } from "../changes/just-deleted.tsx";
import { describeWhen } from "../when.ts";

/**
 * A workspace's documents on its page (ADR 0020), the most recently changed first, each opening
 * its page. Hidden until there's one, so a new workspace looks as it did, unless one was just
 * deleted: that shows with Undo, as Recent changes does.
 */
export function DocumentsSection(props: {
  workspaceId: WorkspaceId;
  documents: readonly DocumentSummary[];
  /** A document just deleted from its page, and the change that deleted it, for Undo. */
  deleted?: { readonly name: string; readonly change: ChangeId | undefined };
  /** Once a delete is undone: the page loads the list again. */
  onUndone: () => Promise<void>;
}) {
  const { workspaceId, documents, deleted } = props;
  if (documents.length === 0 && deleted === undefined) return null;

  return (
    <section aria-label="Documents" className="mt-12">
      <div className="flex items-baseline justify-between gap-3">
        <SectionTitle>Documents</SectionTitle>
        {documents.length > 0 && (
          <span className="text-xs text-muted-foreground">{documents.length}</span>
        )}
      </div>
      <p className="mt-1 text-sm/[21px] text-muted-foreground">
        Longer things saved here. Every model knows they're here and reads one when it helps.
      </p>
      {deleted !== undefined && (
        <JustDeleted name={deleted.name} change={deleted.change} onUndone={props.onUndone} />
      )}
      {documents.length > 0 && (
        <ul className="mt-2 divide-y">
          {documents.map((document) => (
            <li key={document.slug}>
              <Link
                to="/workspaces/$workspaceId/documents/$slug"
                params={{ workspaceId, slug: document.slug }}
                className={LIST_ROW}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <FileText aria-hidden className="size-[18px] shrink-0 text-primary-text" />
                  <span className="truncate">{document.name}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {describeWhen(document.updatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
