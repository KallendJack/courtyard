import type { Activity, ApprovalAsk } from "@courtyard/contract";
import { z } from "zod";
import { PAPER_FAILED, PAPER_MAKES_NO_FILES, paperFileOnly } from "../prompts/index.ts";
import type { ToolCall, ToolConnection, ToolContent } from "../providers/index.ts";
import { err, ok, type Result } from "../result.ts";
import type { PaperSettings } from "../workspaces/index.ts";

/**
 * Paper in code workspaces (ADR 0023): the first tool connection. A code workspace's config names
 * Paper's command on the worker machine and the one Paper file its sessions draw in. Reading and
 * drawing run without asking; deleting anything the session didn't make waits for the owner's
 * approval; and each screenshot a model takes shows in the chat.
 */

/** The tool connection's name, which is also its MCP server's. */
const NAME = "paper";
/** What the owner sees it called. */
const LABEL = "Paper";

/** Paper's tools that name no file: its guides, its list of files, and the fonts it has. */
const FILELESS = new Set(["get_guide", "list_resources", "get_font_family_info"]);
/** Paper's tools that make or rename files, outside the one a workspace uses. */
const FILE_MAKERS = new Set(["create_file", "rename_resource"]);
/** Paper's tools that make nodes, whose answers name what they made. */
const MAKERS = new Set(["create_artboard", "write_html", "duplicate_nodes"]);

const Call = z.looseObject({ fileId: z.string().optional() });
const Deleting = z.looseObject({ nodeIds: z.array(z.string()) });
const Screenshot = z.looseObject({ nodeId: z.string() });

/** Every string in a value, however deep. */
const stringsIn = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(stringsIn);
  return [];
};

/** A key that names a node made: an id, but not a file's, page's, parent's or source's. */
const MADE_KEY = /ids?$/i;
const OTHER_KEY = /^(file|page|parent|source|team|target|original)/i;

/**
 * The nodes a call that makes nodes says it made, from its JSON answer: each id under a key that
 * names one (`id`, `nodeId`, `newNodeIds`…) and every id a duplicate's `descendantIdMap` maps to,
 * leaving out any id the call was given. Paper doesn't document its answers' shape, so this is
 * careful: an id it misses only means deleting that node asks.
 */
const madeIn = (call: ToolCall, content: readonly ToolContent[]) => {
  const given = new Set(stringsIn(call.input));
  const made: string[] = [];
  const walk = (value: unknown, key: string | undefined) => {
    if (Array.isArray(value)) {
      for (const each of value) walk(each, key);
    } else if (typeof value === "object" && value !== null) {
      for (const [inner, each] of Object.entries(value)) {
        if (inner === "descendantIdMap") made.push(...stringsIn(Object.values(each ?? {})));
        else walk(each, inner);
      }
    } else if (typeof value === "string" && key !== undefined) {
      if (MADE_KEY.test(key) && !OTHER_KEY.test(key)) made.push(value);
    }
  };
  for (const part of content) {
    if (part.kind !== "text") continue;
    try {
      walk(JSON.parse(part.text), undefined);
    } catch {
      // Not JSON: nothing it made is named.
    }
  }
  return made.filter((id) => !given.has(id));
};

/** An image's data URL as its kind and bytes, or `undefined` when it isn't one. */
const imageOf = (dataUrl: string) => {
  const [, mediaType, data] = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl) ?? [];
  return mediaType === undefined || data === undefined
    ? undefined
    : { mediaType, bytes: Buffer.from(data, "base64") };
};

/**
 * Paper's connection for one turn of a code session (ADR 0023): Paper's MCP server, and the
 * worker's say on each call, with what each call did kept for the session.
 */
export const paperConnection = (options: {
  settings: PaperSettings;
  /** The nodes the session's turns made, which they may delete without asking. */
  made: Set<string>;
  /** Asks the owner's approval and waits for it (#171): allowed, or why not. */
  approve: (ask: ApprovalAsk, allowed: Activity) => Promise<Result<null, string>>;
  /** Tells the owner what the model is doing. */
  report: (activity: Activity) => Promise<void>;
  /** Shows the owner a screenshot the model took of a node, in the chat. */
  show: (image: { of: string; mediaType: string; bytes: Uint8Array }) => Promise<void>;
}): ToolConnection => {
  const { settings, made } = options;
  return {
    name: NAME,
    server: { command: settings.command, args: ["mcp"] },

    check: async (call) => {
      const used: Activity = { kind: "used-tool", connection: LABEL, action: call.tool };
      if (FILE_MAKERS.has(call.tool)) return err(PAPER_MAKES_NO_FILES);
      if (!FILELESS.has(call.tool)) {
        const named = Call.safeParse(call.input);
        if (!named.success || named.data.fileId !== settings.fileId) {
          return err(paperFileOnly(settings.fileId));
        }
      }
      if (call.tool === "delete_nodes") {
        const deleting = Deleting.safeParse(call.input);
        const nodes = deleting.success ? deleting.data.nodeIds : [];
        if (!deleting.success || nodes.some((node) => !made.has(node))) {
          return options.approve(
            {
              kind: "tool",
              connection: LABEL,
              action: call.tool,
              input: JSON.stringify(call.input),
              reason: "deletes-unmade",
            },
            used,
          );
        }
      }
      await options.report(used);
      return ok(null);
    },

    done: async (call) => {
      if (!call.ok) return PAPER_FAILED;
      if (MAKERS.has(call.tool)) for (const node of madeIn(call, call.content)) made.add(node);
      const shot = call.tool === "get_screenshot" ? Screenshot.safeParse(call.input) : undefined;
      if (shot?.success) {
        for (const part of call.content) {
          const image = part.kind === "image" ? imageOf(part.dataUrl) : undefined;
          if (image !== undefined) await options.show({ of: shot.data.nodeId, ...image });
        }
      }
      return undefined;
    },
  };
};
