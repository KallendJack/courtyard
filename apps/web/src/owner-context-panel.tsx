import {
  hasLines,
  OWNER_CONTEXT_LONG_CHARACTERS,
  type OwnerContextDetail,
} from "@courtyard/contract";
import { Link, useRouter } from "@tanstack/react-router";
import { Button } from "@/components/button";
import { ContextLines, FactsPlansIdeas } from "@/components/context-lines";
import { FormError } from "@/components/form-error";
import { StatusPill } from "@/components/notice";
import { SectionTitle } from "@/components/page";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "./problems.tsx";
import { GetToKnow } from "./sessions/get-to-know.tsx";
import { type FromWorker, startOwnerContext } from "./worker.ts";

/**
 * The owner context on the home page: what every workspace's models read about the owner
 * (ADR 0010), or a way to start one.
 */
export function OwnerContextPanel(props: {
  result: FromWorker<OwnerContextDetail>;
  /** Whether there's a planning workspace for a get-to-know session to run in. */
  canGetToKnow: boolean;
}) {
  const router = useRouter();
  const start = useAction(async () => {
    const started = await startOwnerContext();
    if (started.kind !== "loaded") return describeProblem(started).body;
    await router.invalidate();
    return undefined;
  });

  const { result } = props;
  const ownerContext = result.kind === "loaded" ? result.data.ownerContext : undefined;

  return (
    <section aria-label="Owner context" className="mt-6 rounded-lg border px-4 py-5 md:px-5">
      <SectionTitle>Owner context</SectionTitle>
      <p className="mt-1 text-sm text-muted-foreground">
        What every workspace knows about you. Code workspaces get only how you like answers.
      </p>
      {result.kind !== "loaded" && (
        <div className="mt-4">
          <FormError message={describeProblem(result).body} />
        </div>
      )}
      {props.canGetToKnow &&
        result.kind === "loaded" &&
        !(ownerContext && hasLines(ownerContext)) && (
          <GetToKnow about={{ kind: "owner" }} label="Get to know me">
            You're asked a few questions about your life, and what you say is saved here.
          </GetToKnow>
        )}
      {ownerContext === null && (
        <div className="mt-4 space-y-3">
          <p className="text-[15px]/[23px]">
            Or write down yourself what's true across your life, such as where you live and how you
            like answers, so no workspace needs telling.
          </p>
          <Button variant="outline" onClick={() => void start.run()} disabled={start.busy}>
            Start your owner context
          </Button>
          <FormError message={start.error} />
        </div>
      )}
      {ownerContext && (
        <>
          {ownerContext.characters > OWNER_CONTEXT_LONG_CHARACTERS && (
            <div className="mt-3">
              <StatusPill>
                Getting long: it goes with every message in every workspace, so keep it to what's
                true everywhere.
              </StatusPill>
            </div>
          )}
          {ownerContext.intro !== "" && (
            <p className="mt-4 text-[15px]/[23px] whitespace-pre-line">{ownerContext.intro}</p>
          )}
          <div className="mt-5 space-y-6">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              About me
            </p>
            <FactsPlansIdeas {...ownerContext} />
            <ContextLines
              title="How to answer me"
              hint="Every workspace"
              lines={ownerContext.answers}
            />
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            Edit it in <code>OWNER.md</code>, at the top of your context folder. See{" "}
            <Link to="/owner-context" className="text-foreground underline">
              recent changes
            </Link>
            .
          </p>
        </>
      )}
    </section>
  );
}
