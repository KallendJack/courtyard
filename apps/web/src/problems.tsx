import type { FromWorker } from "./worker.ts";

/** What to show instead of a page when the worker gave no data. */
export function Problem({ result }: { result: Exclude<FromWorker<unknown>, { kind: "loaded" }> }) {
  const [title, body] =
    result.kind === "offline"
      ? [
          "Worker offline",
          "Courtyard can't reach its worker. Check that the machine it runs on is switched on.",
        ]
      : result.kind === "failed"
        ? ["Something went wrong", result.message]
        : ["Not found", "There's nothing here."];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-neutral-600">{body}</p>
    </main>
  );
}
