import { Preview, type SessionId } from "@courtyard/contract";
import { fromWorker, sendJson } from "../../api/worker.ts";

// A code session's preview (#183), as the worker has it.

const previewPath = (sessionId: SessionId) => `/sessions/${encodeURIComponent(sessionId)}/preview`;

/** Where the session's preview stands: serving, starting, or what Start preview would run. */
export const previewOf = (sessionId: SessionId) => fromWorker(previewPath(sessionId), Preview);

/** Start preview: the command the owner confirmed runs as one of the session's tasks. */
export const startPreview = (sessionId: SessionId, command: string) =>
  sendJson({ path: previewPath(sessionId), body: { command }, schema: Preview });

/**
 * The preview's address: the worker's own, on the preview's port, where the owner's HTTPS proxy
 * forwards it to the worker (README, Previews).
 */
export const previewAddress = (port: number) =>
  `${window.location.protocol}//${window.location.hostname}:${port}/`;
