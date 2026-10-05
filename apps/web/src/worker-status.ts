import { Health } from "@courtyard/contract";

export type WorkerStatus = "online" | "offline";

/** Asks the worker's health check whether it's up. Anything but a valid answer counts as offline. */
export const fetchWorkerStatus = async (): Promise<WorkerStatus> => {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) return "offline";
    return Health.safeParse(await response.json()).success ? "online" : "offline";
  } catch {
    return "offline";
  }
};
