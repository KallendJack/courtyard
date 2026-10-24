import type { LeadStatus, SessionId, WorkspaceId } from "@courtyard/contract";
import { createKept, useKept } from "@courtyard/ui/layout/kept.tsx";
import { z } from "zod";
import { sendJson } from "../../api/worker.ts";
import { loadLead } from "../code-home/api.ts";

// The Builders board's calls (#592), and each workspace's Lead as last known, which the board and
// Home's tiles share. No styles, so Home's tiles can load it.

/** Each workspace's Lead as last known, for the tab's lifetime (nothing jumps in late). */
export const KEPT_LEAD = createKept<LeadStatus>();

/** How often it asks again while one of its builders is at work, so a status moves on soon. */
const BUSY_EVERY_MS = 5000;

/** Whether one of its builders is at work, its status moving on as it goes. */
const atWork = (lead: LeadStatus) =>
  lead.statuses.some(({ status }) => status.kind === "building" || status.kind === "checking");

/**
 * A code workspace's Lead (#347), with each builder's status (#590), as last known, asked for again
 * as `again` changes, and kept fresh the shared way (#387), faster while a builder is at work; none
 * asked while `asking` is false.
 */
export const useLead = (workspaceId: WorkspaceId, again?: unknown, asking = true) =>
  useKept(KEPT_LEAD, {
    key: workspaceId,
    load: async () => {
      const loaded = await loadLead(workspaceId);
      return loaded.kind === "loaded" ? loaded.data : undefined;
    },
    ...(again === undefined ? {} : { again }),
    asking,
    busy: (known) => (atWork(known) ? BUSY_EVERY_MS : undefined),
  });

/** Retry (#592): a stuck builder carries on, on the model it last used. */
export const retryBuilder = (sessionId: SessionId) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(sessionId)}/retry`,
    body: {},
    schema: z.unknown(),
  });
