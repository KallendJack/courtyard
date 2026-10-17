import { OfflineCopy } from "@courtyard/contract";
import { fromWorker } from "../../api/worker.ts";
import { describeProblem } from "../../components/layout/problems.tsx";
import { keepCopy, wipeCopy } from "./store.ts";
import { keepsCopy } from "./switch.ts";

/**
 * Asks the worker for a new copy and keeps it in place of the old one: what went wrong, or nothing
 * once it's kept. A device the worker says is logged out (from another device, say) wipes its copy.
 */
export const updateCopy = async (): Promise<string | undefined> => {
  const copy = await fromWorker("/offline-copy", OfflineCopy);
  if (copy.kind === "loaded") {
    // Turned off while it was asked for: nothing is kept.
    if (keepsCopy()) await keepCopy(copy.data);
    return undefined;
  }
  if (copy.kind === "logged-out") await wipeCopy();
  return describeProblem(copy).body;
};
