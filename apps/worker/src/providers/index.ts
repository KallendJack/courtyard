import type {
  Activity,
  Capabilities,
  Effort,
  FailureReason,
  ModelId,
  ModelInfo,
  ModelRef,
  PhotoMediaType,
  ProviderId,
  ProviderStatus,
  SignInState,
  SkillName,
  Source,
} from "@courtyard/contract";
import { z } from "zod";
import type { CommandEnv } from "../git.ts";
import type { Result } from "../result.ts";

export type { Activity };

/** What a model is told for one turn, built by the prompts module (docs/ai-conduct.md). */
export type Framing = {
  /** Who the model is helping, what it may do, and the workspace's context file. */
  readonly instructions: string;
  /** What was said earlier in the session, then the owner's new message. */
  readonly message: string;
  /** The owner's new message on its own, for a provider that needs only that (the fake). */
  readonly newMessage: string;
  /**
   * The session's last attachments, oldest first, as `message` lists them (#78). Each photo goes
   * with the message as an image, in this order, its provider's own way; a PDF's text is already
   * in `message`.
   */
  readonly attachments: readonly FramedAttachment[];
  /**
   * Courtyard's own tools this turn offers, such as the save tool (ADR 0013) and the use skill
   * tool (ADR 0016). Every provider offers each one in its own tool format, and hands each call to
   * the worker through `callTool`, which answers it.
   */
  readonly tools: readonly TurnTool[];
  /**
   * Courtyard's file tools, or `null` when the provider reads no files. Only a provider that
   * reads files through Courtyard offers them (Codex, ADR 0015); Claude reads with Claude Code's.
   */
  readonly fileTools: FileTools | null;
  /** Web search (ADR 0019), or `null` when the turn doesn't offer it. */
  readonly webSearch: WebSearch | null;
};

/**
 * Web search on a turn (ADR 0019): the model searches, and reads pages from its search results or
 * the links the owner sent, and nothing else.
 */
export type WebSearch = {
  /** Every web address in the owner's messages in the session, as they wrote it. */
  readonly ownerLinks: readonly string[];
};

/** An attachment a turn carries: a photo by its file on the worker machine, or a PDF by its name. */
export type FramedAttachment =
  | {
      readonly kind: "photo";
      readonly name: string;
      readonly path: string;
      readonly mediaType: PhotoMediaType;
    }
  | { readonly kind: "pdf"; readonly name: string };

/** Only the photos of a turn's attachments, in order: the images that go with its message. */
export const photosOf = (attachments: readonly FramedAttachment[]) =>
  attachments.flatMap((attachment) => (attachment.kind === "photo" ? [attachment] : []));

/** One of Courtyard's own tools as a model is told about it: its name, what it's for, and each input. */
export type CourtyardTool = {
  readonly name: string;
  readonly description: string;
  /** Each input by name, with what it means as its description. */
  readonly input: Readonly<Record<string, z.ZodType>>;
};

/**
 * The name a model calls each of Courtyard's tools that a turn can offer, and the worker answers:
 * the save tool (ADR 0013), the document and Things tools (ADR 0020), the use skill tool (ADR 0016)
 * and the suggest replies tool (ADR 0017).
 */
export type TurnToolName =
  | "save_to_context"
  | "save_document"
  | "save_thing"
  | "use_skill"
  | "suggest_replies";

/** One of Courtyard's tools that a turn can offer. */
export type TurnTool = CourtyardTool & { readonly name: TurnToolName };

/** Courtyard's tools for looking at the workspace's files, each confined to its folder. */
export type FileTools = {
  readonly list: CourtyardTool;
  readonly read: CourtyardTool;
  readonly search: CourtyardTool;
};

/** Part of what one of Courtyard's tools gives a model: text, or an image. */
export type ToolContent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "image"; readonly dataUrl: string };

/**
 * What one of Courtyard's tools did, as the model is told: whether it did what was asked (a save
 * saved, a file was found), and what to say.
 */
export type ToolReply = { readonly ok: boolean; readonly content: readonly ToolContent[] };

/**
 * A code session's turn (ADR 0007): its session branch's worktree, and the worker's say on each
 * edit and command. A provider asks before every edit and command, does only what's allowed, and
 * tells the model the reason for anything refused.
 */
export type CodeTurn = {
  /** The session branch's worktree: the turn's working directory, and the only place it edits. */
  readonly worktree: string;
  /**
   * What every command it runs gets on top of the environment the provider runs it in (an
   * `undefined` is unset): the session's slot among the code sessions running, so their checks
   * never share ports (spec #169, story 6), and Courtyard's own GitHub sign-in for `git` and `gh`,
   * never the machine's (#99). It names where the sign-in is kept, never the sign-in itself.
   */
  readonly env: CommandEnv;
  /**
   * Matt Pocock's skills (ADR 0023), for a provider that loads skills itself (Claude, as a local
   * plugin): Courtyard's pinned copy of his plugin, its name, and the skills of it to turn on,
   * those the workspace can use. `null` when they aren't loaded. Never the machine's own plugins.
   */
  readonly plugin: CodePlugin | null;
  /**
   * Whether the file at `path` (from the worktree, or absolute) may be edited, or why not. One
   * outside the worktree waits for the owner's approval (#171).
   */
  readonly edit: (path: string) => Promise<Result<null, string>>;
  /**
   * Whether `command` may run in the worktree, or why not. One off the command allowlist waits for
   * the owner's approval (#171), shown with `why`, what the model said it's for, when it said.
   */
  readonly run: (command: string, why?: string) => Promise<Result<null, string>>;
};

/** A plugin a code turn's provider loads itself: its folder, its name and the skills to turn on. */
export type CodePlugin = {
  readonly folder: string;
  readonly name: string;
  readonly skills: readonly SkillName[];
};

export type TurnInput = {
  /** The model to answer with, one of the provider's own. */
  readonly model: ModelId;
  /** One of the levels of effort the model takes, or `undefined` for the model's default. */
  readonly effort: Effort | undefined;
  /**
   * The workspace's folder on the worker machine, or a code session's worktree: the only place a
   * model may look.
   */
  readonly folder: string;
  /** A code session's turn, which only a provider that codes is given; `null` otherwise. */
  readonly code: CodeTurn | null;
  /** Delivered as given: a provider never writes prompt text of its own. */
  readonly framing: Framing;
  /** Hands over the next piece of the answer as it's written. */
  readonly emit: (text: string) => Promise<void>;
  /** Says what the model is doing, such as reading a file. */
  readonly report: (activity: Activity) => Promise<void>;
  /** Lists the web pages the answer used, its Sources, once the answer is written. */
  readonly cite: (sources: readonly Source[]) => Promise<void>;
  /**
   * Hands a call to one of the framing's `tools` to the worker, by the tool's name, its input
   * exactly as the model sent it. The worker checks it, does it, and says what to tell the model.
   */
  readonly callTool: (call: {
    readonly name: string;
    readonly input: unknown;
  }) => Promise<ToolReply>;
  /** Aborted when the owner stops the turn: the provider stops working as soon as it can. */
  readonly signal: AbortSignal;
};

/**
 * A one-off question outside any session, answered once in the shape `schema` describes, such as
 * a tidy's proposed changes. No tools, no files: the model has only what it's told.
 */
export type OneOffInput = {
  /** What it's for, so the fake can script its answer. */
  readonly purpose: "tidy" | "title";
  readonly model: ModelId;
  /** One of the levels of effort the model takes; left out for the model's default. */
  readonly effort?: Effort;
  /** Built by the prompts module, and delivered as given. */
  readonly instructions: string;
  readonly message: string;
  /** The answer's shape. The provider asks for it; the caller still checks what comes back. */
  readonly schema: z.ZodType;
  readonly signal: AbortSignal;
};

/**
 * A provider's sign-in, for a provider whose sign-in Courtyard handles (Codex's, ADR 0015). It
 * stays in the provider's own home: Courtyard only ever sees a sign-in's link and one-time code.
 */
export type SignIn = {
  /** What the owner signs in to, by name: "ChatGPT". */
  readonly service: string;
  readonly state: () => Promise<SignInState>;
  /** Starts a sign-in to finish on any device, or says why it couldn't. */
  readonly start: () => Promise<Result<SignInState, string>>;
  /** Gives up a sign-in in progress, or forgets one that didn't finish. */
  readonly cancel: () => Promise<void>;
  readonly signOut: () => Promise<Result<null, string>>;
};

/**
 * A source of models: the one seam in the worker (AGENTS.md). Claude, Codex and the scripted fake
 * each sit behind it. A turn's failure is returned, never thrown.
 */
export type Provider = {
  readonly id: ProviderId;
  /** What its models can do, which decides what a turn tells them they may do. */
  readonly capabilities: Capabilities;
  readonly status: () => Promise<ProviderStatus>;
  readonly runTurn: (input: TurnInput) => Promise<Result<null, FailureReason>>;
  /** Answers a one-off question: the answer unparsed, or why there's none. */
  readonly answerOnce: (input: OneOffInput) => Promise<Result<unknown, FailureReason>>;
  /** Its sign-in, when Courtyard handles it; Claude's is the worker machine's own. */
  readonly signIn?: SignIn;
};

/**
 * The provider offering this model right now, and what it says of the model (its levels of
 * effort, say), or `undefined` when none is.
 */
export const offerFor = async (
  providers: readonly Provider[],
  ref: ModelRef,
): Promise<{ provider: Provider; model: ModelInfo } | undefined> => {
  const provider = providers.find((p) => p.id === ref.provider);
  if (!provider) return undefined;
  const status = await provider.status();
  const model = status.available ? status.models.find((m) => m.id === ref.model) : undefined;
  return model === undefined ? undefined : { provider, model };
};

/** Every model these providers offer right now, in order, each with its provider. */
export const modelsOnOffer = async (providers: readonly Provider[]) => {
  const offers = await Promise.all(
    providers.map(async (provider) => ({ provider, status: await provider.status() })),
  );
  return offers.flatMap(({ provider, status }) =>
    status.available ? status.models.map((model) => ({ provider, model })) : [],
  );
};

/** The first model with room: on offer and not at its usage limit. */
export const firstWithRoom = <T extends { model: ModelInfo }>(offered: readonly T[]) =>
  offered.find(({ model }) => model.limit === undefined);

/**
 * The first model on offer whose provider saves to context and isn't at its usage limit (the first
 * that saves, when every one is): what Get to know and Tidy use when no model is named.
 * `undefined` when no provider that saves is available.
 */
export const firstSavingModel = async (
  providers: readonly Provider[],
): Promise<ModelRef | undefined> => {
  const offered = await modelsOnOffer(
    providers.filter((provider) => provider.capabilities.savesContext),
  );
  const chosen = firstWithRoom(offered) ?? offered[0];
  return chosen && { provider: chosen.provider.id, model: chosen.model.id };
};

/** A schema as Claude Code and Codex's app-server take it: JSON Schema without the `$schema` line. */
export const jsonSchemaOf = (schema: z.ZodType) => {
  const { $schema: _, ...rest } = z.toJSONSchema(schema);
  return rest;
};

export { createClaudeProvider } from "./claude.ts";
export { createCodexProvider } from "./codex.ts";
export { createFakeProvider } from "./fake.ts";
