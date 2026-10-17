import { useFresh } from "@/components/layout/kept";
import { updateCopy } from "./api.ts";

/** How often an open app updates its copy, besides when it opens and comes back into view. */
const UPDATE_EVERY_MS = 15 * 60 * 1000;

/**
 * Keeps this device's copy up to date while Read offline is on (#106): when Courtyard opens or
 * comes back into view, then every 15 minutes while it's open, the shared way (`useFresh`).
 */
export default function KeepCopyFresh() {
  useFresh({ ask: updateCopy, calmEveryMs: UPDATE_EVERY_MS, atOnce: true });
  return null;
}
