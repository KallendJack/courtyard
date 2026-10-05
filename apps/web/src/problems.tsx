import { Link } from "@tanstack/react-router";
import type { FromWorker } from "./worker.ts";

type NoData = Exclude<FromWorker<unknown>, { kind: "loaded" }>;

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

/** What to show instead of a page when the worker gave no data. */
export function Problem({ result }: { result: NoData }) {
  const { title, body } = describeProblem(result);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-neutral-600">{body}</p>
      {result.kind === "logged-out" && (
        <Link to="/login" className="mt-3 inline-block underline">
          Log in again
        </Link>
      )}
    </main>
  );
}
