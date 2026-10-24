import type { ContextBackup, WorkspaceId, WorkspaceSummary } from "@courtyard/contract";
import { PlaceholderRows } from "@courtyard/ui/layout/kept.tsx";
import { ButtonLink } from "@/components/buttons/button-link";
import { describeWhen } from "../../lib/when.ts";
import { LiveUpdate } from "../live/live-update.tsx";
import { useBackup } from "../settings/backup-status.tsx";
import "./stylesheet.ts";

/**
 * Something actually wrong, in a few words, and where it's fixed: the backup in Settings, which
 * says what's wrong with it and what to do; a workspace's config on its page, which says why.
 */
type Problem = {
  readonly words: string;
  readonly fix:
    | { readonly kind: "backup" }
    | { readonly kind: "workspace"; readonly id: WorkspaceId };
};

const BACKUP_FIX: Problem["fix"] = { kind: "backup" };

/** "08:36" today, then the day: "Yesterday", "2 Oct". */
const sinceWords = (iso: string) => {
  const when = describeWhen(iso);
  return when.startsWith("Today, ") ? when.slice("Today, ".length) : when;
};

/**
 * What's wrong, worst first: context changes not kept at all, then a backup that's behind, then a
 * workspace whose config was ignored, then a context with no backup set up.
 */
const problemsOf = (
  backup: ContextBackup | undefined,
  workspaces: readonly WorkspaceSummary[],
): Problem[] => [
  ...(backup?.kind === "not-kept"
    ? [{ words: "Context changes aren't being kept", fix: BACKUP_FIX }]
    : []),
  ...(backup?.kind === "behind"
    ? [{ words: `Backup behind since ${sinceWords(backup.since)}`, fix: BACKUP_FIX }]
    : []),
  ...workspaces.flatMap((workspace): Problem[] =>
    workspace.configProblem === undefined
      ? []
      : [
          {
            words: `${workspace.name}'s config is ignored`,
            fix: { kind: "workspace", id: workspace.id },
          },
        ],
  ),
  ...(backup?.kind === "not-set-up" ? [{ words: "Context isn't backed up", fix: BACKUP_FIX }] : []),
];

/**
 * Home's foot rows (#102; Paper, "Home"), near the thumbs and only when needed: main's build with
 * Update when a new version is there (`live/`), and one gold line for something actually wrong,
 * the worst, "and 1 more" when there's more, with Fix it, which opens where it's fixed. Both keep
 * their size when all's well, with a quiet line each (#283; Paper, "Home, foot slots keep their
 * size"), and their place while they're still to come, so nothing moves when they do.
 */
export default function HomeFoot(props: {
  workspaces: readonly WorkspaceSummary[];
  /** On a narrow screen: main's build as the cover screen's board has it. */
  short: boolean;
}) {
  const backup = useBackup();
  const [worst, ...more] = problemsOf(backup, props.workspaces);
  return (
    <div className="flex flex-col gap-2.5 md:gap-3">
      <LiveUpdate label="New version" short={props.short} keepsPlace />
      {worst === undefined && backup === undefined && <PlaceholderRows count={1} size="foot" />}
      {worst === undefined && backup !== undefined && (
        <section
          aria-label="Backup"
          className="flex min-h-13 items-center gap-3 rounded-bubble border bg-surface py-2 pr-2.5 pl-4"
        >
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-placeholder" />
          <p className="min-w-0 grow text-sm/4.5 font-medium text-muted-foreground">Backed up</p>
        </section>
      )}
      {worst !== undefined && (
        <section
          aria-label="Problem"
          className="flex min-h-13 items-center gap-3 rounded-bubble border border-warning/25 bg-surface py-2 pr-2.5 pl-4"
        >
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning" />
          <p className="min-w-0 grow text-sm/4.5 font-semibold">
            {worst.words}
            {more.length > 0 && `, and ${more.length} more`}
          </p>
          {worst.fix.kind === "backup" ? (
            <ButtonLink variant="outline" to="/settings" hash="backup">
              Fix it
            </ButtonLink>
          ) : (
            <ButtonLink
              variant="outline"
              to="/workspaces/$workspaceId"
              params={{ workspaceId: worst.fix.id }}
            >
              Fix it
            </ButtonLink>
          )}
        </section>
      )}
    </div>
  );
}
