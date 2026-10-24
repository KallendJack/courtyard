import type { ToolReply } from "../providers/index.ts";

// The small pieces every part of what a model reads uses: the markers that keep the owner's text
// apart from the instructions, a name in quotes, and a tool's reply in words.

/**
 * The markers that keep the owner's, the workspace's and the session's text apart from the
 * instructions, and each skill's text apart from the rest (ADR 0016).
 */
const MARKERS = [
  "owner_context",
  "context_file",
  "documents",
  "things",
  "conversation",
  "skills",
  "skill",
  "attachments",
  "attachment",
  "pull_request",
  "build_order",
  "output",
  "session_notes",
  "session_note",
  "projects",
  "project",
  "builds",
  "document",
] as const;
const CLOSING_MARKER = new RegExp(`<\\s*/\\s*(${MARKERS.join("|")})\\s*>`, "gi");

/** Stops text from closing a marker, in any spelling a model might read as one. */
export const contained = (text: string) => text.replace(CLOSING_MARKER, "<\\/$1>");

/** A name on one line, in quotes it can't close. */
export const quoted = (name: string) => JSON.stringify(name.replace(/\s+/g, " ").trim());

/** A tool's reply that's only words. */
export const textReply = (ok: boolean, text: string): ToolReply => ({
  ok,
  content: [{ kind: "text", text }],
});
