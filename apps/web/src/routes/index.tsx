import { createFileRoute } from "@tanstack/react-router";
import { fetchWorkerStatus } from "../worker-status.ts";

export const Route = createFileRoute("/")({
  loader: fetchWorkerStatus,
  component: Home,
});

function Home() {
  const status = Route.useLoaderData();

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">Courtyard</h1>
      <p className="mt-2 text-neutral-600">
        {status === "online" ? "Worker online" : "Worker offline"}
      </p>
    </main>
  );
}
