import { FRESH_START_WORDS, type FreshStartSummary } from "@courtyard/contract";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import { ButtonLink } from "@/components/button-link";
import { FormError } from "@/components/form-error";
import { InfoBox, Notice } from "@/components/notice";
import { Page, PageTitle } from "@/components/page";
import { TextField } from "@/components/text-field";
import { useAction } from "@/lib/use-action";
import { startFresh } from "../../fresh-start/api.ts";
import { describeProblem, Problem } from "../../problems.tsx";

export const Route = createFileRoute("/_app/fresh-start")({
  // The loader stays in the first load, so its schemas load with the page.
  loader: async () => {
    const { loadFreshStart } = await import("../../fresh-start/api.ts");
    return { summary: await loadFreshStart() };
  },
  component: FreshStart,
});

/** A list under its heading: what goes, or what stays. */
function Kept(props: { heading: string; goes?: boolean; items: readonly string[] }) {
  return (
    <section aria-label={props.heading} className="flex flex-col gap-2 text-sm/[22px]">
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

const tidiesWaiting = (count: number) =>
  count === 0
    ? []
    : [count === 1 ? "A tidy waiting for review" : `${count} tidies waiting for review`];

/** The turn that stops a fresh start, with a way to it. */
function StillRunning(props: { running: NonNullable<FreshStartSummary["running"]> }) {
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
  const { summary } = Route.useLoaderData();
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
  const { workspaces, sessions, tidies, running, folder } = summary.data;
  const matches = typed.trim().toLowerCase() === FRESH_START_WORDS;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (matches && running === null) void start.run();
  };

  return (
    <Page>
      <PageTitle above={<BackLink workspaceId={undefined} />}>Fresh start</PageTitle>
      <p className="mt-2 text-[15px]/[23px] text-muted-foreground">
        Clear everything and start Courtyard as on its first run. Use it once you've finished trying
        things out, or any time you want a clean slate.
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Kept
          heading="Goes"
          goes
          items={[
            `Every workspace (${workspaces}), archived ones too`,
            "Your owner context",
            `Every session (${sessions})`,
            ...tidiesWaiting(tidies),
          ]}
        />
        <Kept
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

      <form onSubmit={submit} className="mt-6 flex flex-col gap-1.5">
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
            disabled={!matches || running !== null || start.busy}
          >
            Start fresh
          </Button>
          <ButtonLink variant="quiet" size="lg" to="/">
            Cancel
          </ButtonLink>
        </div>
        <p className="text-xs/[18px] text-muted-foreground">
          The button works once the words match.
        </p>
        <FormError message={start.error} />
      </form>
    </Page>
  );
}
