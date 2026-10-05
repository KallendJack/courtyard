import { Health } from "@courtyard/contract";
import { Link, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import type { FromWorker } from "./worker.ts";

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

/** While the worker is offline, keeps asking whether it's back, and reloads the page's data when it is. */
const useRecoverWhenWorkerReturns = (offline: boolean) => {
  const router = useRouter();
  useEffect(() => {
    if (!offline) return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch("/api/health");
        if (Health.safeParse(await response.json()).success) await router.invalidate();
      } catch {
        // Still offline; ask again next time.
      }
    }, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [offline, router]);
};

/** What to show instead of a page when the worker gave no data. */
export function Problem({ result }: { result: NoData }) {
  const { title, body } = describeProblem(result);
  useRecoverWhenWorkerReturns(result.kind === "offline");

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-neutral-600">{body}</p>
      {result.kind === "offline" && (
        <p className="mt-2 text-sm text-neutral-500">
          This page will carry on by itself when it's back.
        </p>
      )}
      {result.kind === "logged-out" && (
        <Link to="/login" className="mt-3 inline-block underline">
          Log in again
        </Link>
      )}
    </main>
  );
}
