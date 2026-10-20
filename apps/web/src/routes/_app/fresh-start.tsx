import { FRESH_START_WORDS, type RunningTurn } from "@courtyard/contract";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { BackLink } from "@/components/buttons/back-link";
import { Button } from "@/components/buttons/button";
import { ButtonLink } from "@/components/buttons/button-link";
import { FormError } from "@/components/forms/form-error";
import { TextField } from "@/components/forms/text-field";
import { InfoBox, Notice } from "@/components/layout/notice";
import { Page, PageTitle } from "@/components/layout/page";
import { useAction } from "@/hooks/use-action";
import { describeProblem, Problem } from "../../components/layout/problems.tsx";
import { startFresh } from "../../features/fresh-start/api.ts";

export const Route = createFileRoute("/_app/fresh-start")({
  // The loader stays in the first load, so its schemas load with the page.
  loader: () => import("../../features/fresh-start/api.ts").then((api) => api.loadFreshStart()),
  component: FreshStart,
});

/** A list under its heading: what goes, or what stays. */
function GoesOrStays(props: { heading: string; goes?: boolean; items: readonly string[] }) {
  return (
    <section aria-label={props.heading} className="flex flex-col gap-2 text-sm/5.5">
      <h2 className={props.goes ? "font-semibold text-destructive-text" : "font-semibold"}>
        {props.heading}
      </h2>
      <ul className="flex flex-col gap-2">
        {props.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

/** The turn that stops a fresh start, with a way to it. */
function StillRunning(props: { running: RunningTurn }) {
  const { running } = props;
  return (
    <Notice
      title="A turn is still running"
      action={
        <ButtonLink
          variant="notice"
          size="sm"
          to="/workspaces/$workspaceId/sessions/$sessionId"
          params={{ workspaceId: running.workspaceId, sessionId: running.id }}
        >
          Open it
        </ButtonLink>
      }
    >
      “{running.title}” in {running.workspaceName} is answering. Stop it or let it finish, then
      start fresh.
    </Notice>
  );
}

/**
 * Fresh start (spec stories 105-107): clears everything from trying Courtyard out, once the owner
 * has typed the words. On a page of its own, off the first load.
 */
function FreshStart() {
  const summary = Route.useLoaderData();
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const start = useAction(async () => {
    const started = await startFresh();
    if (started.kind !== "loaded") {
      // A turn may have started meanwhile: the page shows it.
      await router.invalidate();
      return describeProblem(started).body;
    }
    // Home, as on a first run: every list of workspaces is empty now.
    await router.navigate({ to: "/" });
    await router.invalidate();
    return undefined;
  });

  if (summary.kind !== "loaded") return <Problem result={summary} />;
  const { workspaces, sessions, running, folder } = summary.data;
  // Any case: a phone capitalises the first letter. The worker gets the exact words either way.
  const matches = typed.trim().toLowerCase() === FRESH_START_WORDS;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (matches && running === null) void start.run();
  };

  return (
    <Page
      header={
        <>
          <PageTitle above={<BackLink workspaceId={undefined} />}>Fresh start</PageTitle>
          <p className="mt-2 text-body text-muted-foreground">
            Clear everything and start Courtyard as on its first run. Use it once you've finished
            trying things out, or any time you want a clean slate.
          </p>
        </>
      }
      footer={
        <form onSubmit={submit} className="flex flex-col gap-1.5 border-t pt-4 pb-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full md:w-80">
              <TextField
                label={`Type “${FRESH_START_WORDS}” to confirm`}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <Button
              type="submit"
              variant="destructiveFilled"
              size="lg"
              disabled={!matches || running !== null}
              busy={start.busy}
              busyLabel="Starting fresh…"
            >
              Start fresh
            </Button>
            <ButtonLink variant="quiet" size="lg" to="/settings">
              Cancel
            </ButtonLink>
          </div>
          <p className="text-meta text-muted-foreground">The button works once the words match.</p>
          {/* A turn that stopped it is named in its notice above, so it's said once. */}
          {running === null && <FormError message={start.error} />}
        </form>
      }
    >
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <GoesOrStays
          heading="Goes"
          goes
          items={[
            `Every workspace (${workspaces}), archived ones too`,
            "Your owner context",
            "Every other file in the context folder",
            `Every session (${sessions})`,
          ]}
        />
        <GoesOrStays
          heading="Stays"
          items={[
            "Your password, and the devices logged in",
            "Claude and Codex, signed in as they are",
            "Usage limits Courtyard knows about",
          ]}
        />
      </div>

      <InfoBox label="Nothing is lost">
        <div>
          <p className="font-semibold">Nothing is lost</p>
          <p>
            The context folder's history (and its backup) keeps every line, and the old sessions
            move to <code className="whitespace-nowrap">{folder}</code> in the data folder. The
            README says how to bring them back by hand.
          </p>
        </div>
      </InfoBox>

      {running !== null && (
        <div className="mt-6">
          <StillRunning running={running} />
        </div>
      )}
    </Page>
  );
}
