import { FRESH_START_WORDS, FreshStartSummary } from "@courtyard/contract";
import { z } from "zod";
import { fromWorker, sendJson } from "../worker.ts";

// Fresh start's calls live with it rather than in worker.ts, so its schemas stay off the first load.

/** What a fresh start would clear now, and any running turn that stops it. */
export const loadFreshStart = () => fromWorker("/fresh-start", FreshStartSummary);

/** Starts fresh, confirmed with the words the owner typed. */
export const startFresh = () =>
  sendJson({ path: "/fresh-start", body: { confirm: FRESH_START_WORDS }, schema: z.unknown() });
