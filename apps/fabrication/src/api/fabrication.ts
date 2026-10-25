import {
  ApiError,
  ATTACHMENTS_FIELD,
  AuthState,
  BuildChat,
  BuildChatSent,
  BuildOpened,
  BuildProgress,
  type BuildSlug,
  type ChangeId,
  MadePart,
  MESSAGE_FIELD,
  type NewMessage,
  ProviderList,
  type ToolPick,
  ToolsHeard,
  ToolsSaved,
  type WorkspaceId,
  YourTools,
} from "@courtyard/contract";
import { z } from "zod/mini";
import type { $ZodType } from "zod/v4/core";

// Fabrication calls only Fabrication's API (ADR 0037, #697), and Courtyard's login (ADR 0002),
// which it shares, being on the same origin.

/** What came back: the data, or why there isn't any. */
export type Answer<T> =
  | { readonly kind: "loaded"; readonly data: T }
  | { readonly kind: "not-found" }
  | { readonly kind: "logged-out" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "offline" };

/** Reads a response with the contract's schema; anything unexpected counts as unreachable. */
const read = async <T>(response: Response, schema: $ZodType<T>): Promise<Answer<T>> => {
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = z.safeParse(schema, body);
    return parsed.success ? { kind: "loaded", data: parsed.data } : { kind: "offline" };
  }
  if (response.status === 404) return { kind: "not-found" };
  if (response.status === 401) return { kind: "logged-out" };
  const error = ApiError.safeParse(body);
  return error.success ? { kind: "failed", message: error.data.error } : { kind: "offline" };
};

const ask = async <T>(path: string, schema: $ZodType<T>, init?: RequestInit) => {
  try {
    return await read(await fetch(`/api${path}`, init), schema);
  } catch {
    return { kind: "offline" } as const;
  }
};

/** Whether this device is logged in to Courtyard. */
export const authState = () => ask("/auth", AuthState);

const buildPath = (workspaceId: WorkspaceId, slug: BuildSlug) =>
  `/fabrication/workspaces/${encodeURIComponent(workspaceId)}/builds/${encodeURIComponent(slug)}`;

/** A Build with everything derived, and where it is. */
export const openBuild = (workspaceId: WorkspaceId, slug: BuildSlug) =>
  ask(buildPath(workspaceId, slug), BuildOpened);

/** A printed part's Build made (#702): its size and triangles from the solid, and its files. */
export const madePart = (workspaceId: WorkspaceId, slug: BuildSlug) =>
  ask(`${buildPath(workspaceId, slug)}/print`, MadePart);

/** Where one of a printed part's files downloads from, by its name. */
export const printFile = (workspaceId: WorkspaceId, slug: BuildSlug, file: string) =>
  `/api${buildPath(workspaceId, slug)}/print/${encodeURIComponent(file)}`;

/** A Build's chat: what's been said in its session. */
export const buildChat = (workspaceId: WorkspaceId, slug: BuildSlug) =>
  ask(`${buildPath(workspaceId, slug)}/chat`, BuildChat);

/** The models the chat can answer with, for its Reply box. */
export const chatModels = () => ask("/fabrication/models", ProviderList);

/** The owner's tools, and the workspaces' Things that look like tools, to move. */
export const yourTools = () => ask("/fabrication/tools", YourTools);

const sendJson = <T>(path: string, schema: $ZodType<T>, method: string, body: unknown) =>
  ask(path, schema, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** Your tools' Save: every tool the owner has now. */
export const saveTools = (tools: readonly ToolPick[]) =>
  sendJson("/fabrication/tools", ToolsSaved, "PUT", { tools });

/** Undo of a Save of the owner's tools. */
export const undoTools = (change: ChangeId) =>
  sendJson("/fabrication/tools/undo", z.null(), "POST", { change });

/** "Or just say it": the tools a model heard in what was said, to tick; nothing is saved. */
export const hearTools = (said: string) =>
  sendJson("/fabrication/tools/heard", ToolsHeard, "POST", { said });

/** How far the owner has got with a Build's steps (#699), kept for every device. */
export const keepProgress = (
  where: { workspaceId: WorkspaceId; slug: BuildSlug },
  progress: BuildProgress,
) =>
  sendJson(`${buildPath(where.workspaceId, where.slug)}/progress`, BuildProgress, "PUT", progress);

/** The owner's next message in a Build's chat, with any photos or PDFs attached. */
export const sendToChat = (
  where: { workspaceId: WorkspaceId; slug: BuildSlug },
  message: NewMessage,
  files: readonly File[],
) => {
  const path = `${buildPath(where.workspaceId, where.slug)}/chat`;
  if (files.length === 0) {
    return ask(path, BuildChatSent, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    });
  }
  const form = new FormData();
  form.set(MESSAGE_FIELD, JSON.stringify(message));
  for (const file of files) form.append(ATTACHMENTS_FIELD, file);
  return ask(path, BuildChatSent, { method: "POST", body: form });
};
