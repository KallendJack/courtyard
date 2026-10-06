import { OWNER_CONTEXT_LONG_CHARACTERS, type OwnerContextDetail } from "@courtyard/contract";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { ContextLines, FactsPlansIdeas } from "@/components/context-lines";
import { StatusPill } from "@/components/notice";
import { SectionTitle } from "@/components/page";
import { describeProblem } from "./problems.tsx";
import { type FromWorker, startOwnerContext } from "./worker.ts";

/**
 * The owner context on the home page: what every workspace's models read about the owner
 * (ADR 0010), or a way to start one.
 */
export function OwnerContextPanel(props: { result: FromWorker<OwnerContextDetail> }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    const started = await startOwnerContext();
    setStarting(false);
    if (started.kind !== "loaded") return setError(describeProblem(started).body);
    setError(undefined);
    await router.invalidate();
  };

  const { result } = props;
  const owner = result.kind === "loaded" ? result.data.ownerContext : undefined;

  return (
    <section aria-label="Owner context" className="mt-6 rounded-lg border px-4 py-5 md:px-5">
      <SectionTitle>Owner context</SectionTitle>
      <p className="mt-1 text-sm text-muted-foreground">
        What every workspace knows about you. Code workspaces get only how you like answers.
      </p>
      {result.kind !== "loaded" && (
        <p className="mt-4 text-sm text-destructive-text">{describeProblem(result).body}</p>
      )}
      {owner === null && (
        <div className="mt-4 space-y-3">
          <p className="text-[15px]/[23px]">
            Write down once what's true across your life, such as where you live and how you like
            answers, so no workspace needs telling.
          </p>
          {/* A plain button: shadcn's Button would put its class-merging code on the first load. */}
          <button
            type="button"
            onClick={start}
            disabled={starting}
            className="h-9 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Start your owner context
          </button>
          {error && (
            <p role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          )}
        </div>
      )}
      {owner && (
        <>
          {owner.characters > OWNER_CONTEXT_LONG_CHARACTERS && (
            <div className="mt-3">
              <StatusPill>
                Getting long: it goes with every message in every workspace, so keep it to what's
                true everywhere.
              </StatusPill>
            </div>
          )}
          <div className="mt-5 space-y-6">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              About me
            </p>
            <FactsPlansIdeas {...owner} />
            <ContextLines title="How to answer me" hint="Every workspace" lines={owner.answers} />
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            Edit it in <code>OWNER.md</code>, at the top of your context folder.
          </p>
        </>
      )}
    </section>
  );
}
