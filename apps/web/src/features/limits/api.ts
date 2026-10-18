import { type ProviderId, UsageList } from "@courtyard/contract";
import { createKept, useKept } from "@/components/layout/kept";
import { fromWorker, sendJson } from "../../api/worker.ts";

// Usage at a glance (#66): each provider's plan meters and the warnings, as the worker decides them.

/** The usage as the worker last knew it; `read` asks it to read afresh first (the Model sheet). */
const loadUsage = (read: boolean) => fromWorker(`/usage${read ? "?read=1" : ""}`, UsageList);

/** Not now: a provider's warning put off until its window resets. */
export const putOffWarning = (provider: ProviderId) =>
  sendJson({ path: "/usage/not-now", body: { provider }, schema: UsageList });

/** The usage as last known, one for every screen, so Not now on one shows on all. */
export const KEPT_USAGE = createKept<UsageList>();
const KEY = "usage";

/**
 * The usage as last known (`undefined` until it's come), kept fresh the shared way (#387). While
 * `reading` (the Model sheet, open), the worker reads it afresh, at most once a minute.
 */
export const useUsage = (options: { reading?: boolean; asking?: boolean } = {}) => {
  const reading = options.reading === true;
  return useKept(KEPT_USAGE, {
    key: KEY,
    load: async () => {
      const loaded = await loadUsage(reading);
      return loaded.kind === "loaded" ? loaded.data : undefined;
    },
    again: reading,
    ...(options.asking === undefined ? {} : { asking: options.asking }),
  });
};

/** Keeps what the worker answered, for every screen showing the usage. */
export const keepUsage = (usage: UsageList) => KEPT_USAGE.set(KEY, usage);
