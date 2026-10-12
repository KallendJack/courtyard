import type { NextUpIssue, ProviderList, WorkspaceId } from "@courtyard/contract";
import { useNavigate } from "@tanstack/react-router";
import { Zap } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { Block } from "@/components/home-block";
import { PlaceholderRows } from "@/components/kept";
import { classes } from "@/lib/classes";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import { codingModelIn } from "../review/api.ts";
import { buildIssue } from "./api.ts";

/** How many issues show before More. */
const SHOWN = 3;

/**
 * Next up (#301; Paper, "Code workspace Home"): the repository's ready issues nobody has claimed,
 * in milestone order, three of them then More, the milestone they're in beside its label. The
 * first has Build (#298): one tap shows the issue and the model it'll be built with, a second
 * starts the session, which the worker claims the issue for. Hidden when none is ready.
 */
export function NextUp(props: {
  workspaceId: WorkspaceId;
  /** `undefined` while nothing is known yet (a first visit): the block keeps its place. */
  issues: readonly NextUpIssue[] | undefined;
  providers: ProviderList["providers"];
  /** A narrow column beside the others, or the whole width. */
  beside: boolean;
}) {
  const [more, setMore] = useState(false);
  const column = classes("min-w-0", props.beside && "w-62.5 shrink-0 xl:w-80");
  if (props.issues === undefined) {
    return (
      <div className={column}>
        <Block label="Next up">
          <PlaceholderRows count={1} size="tall" />
          <PlaceholderRows count={2} size="line" />
        </Block>
      </div>
    );
  }
  const [first, ...rest] = props.issues;
  if (first === undefined) return null;
  const shown = more ? rest : rest.slice(0, SHOWN - 1);
  const hidden = rest.length - shown.length;
  return (
    <div className={column}>
      <Block label="Next up" aside={first.milestone ?? undefined}>
        <BuildFirst workspaceId={props.workspaceId} issue={first} providers={props.providers} />
        {shown.length > 0 && (
          <ul className="flex flex-col gap-0.5 pt-1">
            {shown.map((issue) => (
              <li key={issue.number} aria-label={`#${issue.number} ${issue.title}`}>
                <a
                  href={issue.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-8.5 items-center gap-2.5 rounded-md px-2.5 hover:bg-secondary"
                >
                  <span className="w-8.5 shrink-0 text-label font-bold text-placeholder">
                    #{issue.number}
                  </span>
                  <span className="min-w-0 grow truncate text-label font-semibold text-foreground/90">
                    {issue.title}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
        {hidden > 0 && (
          <div>
            <Button variant="quietPrimary" size="xs" onClick={() => setMore(true)}>
              More · {hidden}
            </Button>
          </div>
        )}
      </Block>
    </div>
  );
}

/**
 * The first issue, with Build. Tapped, it shows what starts (the issue, the model, its own branch,
 * the claim on GitHub) with Start building, so one more tap does exactly that (AGENTS.md, Tap or
 * talk).
 */
function BuildFirst(props: {
  workspaceId: WorkspaceId;
  issue: NextUpIssue;
  providers: ProviderList["providers"];
}) {
  const { issue } = props;
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const model = codingModelIn(props.providers);
  const build = useAction(async () => {
    if (model === undefined) return "No model that codes is available right now.";
    const built = await buildIssue(props.workspaceId, issue.number, { model: model.ref });
    if (built.kind !== "loaded") return describeProblem(built).body;
    await navigate({
      to: "/workspaces/$workspaceId/sessions/$sessionId",
      params: { workspaceId: props.workspaceId, sessionId: built.data.id },
    });
    return undefined;
  });
  return (
    <section
      aria-label={`Build #${issue.number}`}
      className="flex flex-col gap-2.5 rounded-row border border-primary/35 bg-primary/12 p-3"
    >
      <div className="flex flex-col gap-0.5">
        <a
          href={issue.url}
          target="_blank"
          rel="noreferrer"
          className="text-sm/4.5 font-bold hover:underline"
        >
          #{issue.number} {issue.title}
        </a>
        <p className="text-label font-medium text-primary-text">Ready to build</p>
      </div>
      {confirming ? (
        <>
          <p className="text-meta text-foreground/90">
            {model === undefined
              ? "No model that codes is available right now."
              : `A new session builds it with ${model.label}, on a branch of its own, and claims it on GitHub.`}
          </p>
          <div className="flex gap-2">
            <Button
              fullWidth
              disabled={build.busy || model === undefined}
              onClick={() => void build.run()}
            >
              <Zap aria-hidden />
              Start building
            </Button>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
          <FormError message={build.error} />
        </>
      ) : (
        <Button fullWidth onClick={() => setConfirming(true)}>
          <Zap aria-hidden />
          Build
        </Button>
      )}
    </section>
  );
}
