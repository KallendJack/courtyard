import { Link, useRouter } from "@tanstack/react-router";
import { Page, PageTitle } from "@/components/page";
import type { FromWorker } from "./worker.ts";
import { useWorkerWatch } from "./worker-watch.ts";

type NoData = Exclude<FromWorker<unknown>, { kind: "loaded" }>;

/** How often an offline page asks whether the worker is back. */
const CHECK_EVERY_MS = 3000;

/** A short title and an explanation for each reason the worker gave no data. */
export const describeProblem = (problem: NoData): { title: string; body: string } => {
  switch (problem.kind) {
    case "offline":
      return {
        title: "Worker offline",
        body: "Courtyard can't reach its worker. Check that the machine it runs on is switched on.",
      };
    case "logged-out":
      return { title: "Logged out", body: "This device's login has ended." };
    case "failed":
      return { title: "Something went wrong", body: problem.message };
    case "not-found":
      return { title: "Not found", body: "There's nothing here." };
  }
};

function WorkerOffline(props: { onBack: () => void }) {
  const reachability = useWorkerWatch({
    watching: true,
    everyMs: CHECK_EVERY_MS,
    onBack: props.onBack,
  });
  const { title, body } = describeProblem({ kind: "offline" });

  return (
    <Page>
      <div className="rounded-lg border bg-card p-6">
        <PageTitle>{title}</PageTitle>
        {reachability === "up" ? (
          // The worker answers its health check, so the problem is something else, most likely an
          // app version the worker no longer understands.
          <p className="mt-2 text-muted-foreground">
            Courtyard's worker is running but answered unexpectedly. Reload the page to update the
            app.
          </p>
        ) : (
          <>
            <p className="mt-2 text-muted-foreground">{body}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              This page will carry on by itself when it's back.
            </p>
          </>
        )}
      </div>
    </Page>
  );
}

/** What to show instead of a page when the worker gave no data. */
export function Problem({ result }: { result: NoData }) {
  const router = useRouter();
  if (result.kind === "offline") return <WorkerOffline onBack={() => void router.invalidate()} />;
  const { title, body } = describeProblem(result);

  return (
    <Page>
      <PageTitle>{title}</PageTitle>
      <p className="mt-2 text-muted-foreground">{body}</p>
      {result.kind === "logged-out" && (
        <Link to="/login" className="mt-3 w-fit font-medium text-primary-text underline">
          Log in again
        </Link>
      )}
    </Page>
  );
}

/**
 * The router's last resort, for when a page's own code can't even be fetched (the worker serves
 * it, so this is the worker being down). The fetch can't be retried in place, so the app reloads
 * itself when the worker is back.
 */
export function AppError() {
  return <WorkerOffline onBack={() => window.location.reload()} />;
}
