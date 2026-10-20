import type {
  Activity,
  Capabilities,
  Effort,
  FailureReason,
  HelperId,
  ModelDefault,
  ModelId,
  ModelInfo,
  ModelRef,
  ModelUsageMeter,
  PhotoMediaType,
  ProviderId,
  ProviderStatus,
  SignInState,
  SkillName,
  Source,
  TaskId,
  UsageWindow,
} from "@courtyard/contract";
import { z } from "zod";
import type { HelperBranch } from "../features/code/index.ts";
import type { CommandEnv } from "../lib/git.ts";
import type { Result } from "../lib/result.ts";

export type { Activity, HelperBranch };

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
  /**
   * Courtyard's coding tools in a code session (#248), or `null` outside one. Only a provider
   * that codes through Courtyard offers them (Codex, whose shell is off); Claude codes with
   * Claude Code's own tools, behind its hook.
   */
  readonly codeTools: CodeTools | null;
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
 * the save tool (ADR 0013), the document and Things tools (ADR 0020), the use skill tool (ADR 0016),
 * the suggest replies tool (ADR 0017), a code workspace's Lead's build order tool (#347),
 * and a code session's preview screenshot tool (#183).
 */
export type TurnToolName =
  | "save_to_context"
  | "save_document"
  | "save_thing"
  | "use_skill"
  | "suggest_replies"
  | "build_order"
  | "preview_screenshot";

/** One of Courtyard's tools that a turn can offer. */
export type TurnTool = CourtyardTool & { readonly name: TurnToolName };

/** Courtyard's tools for looking at the workspace's files, each confined to its folder. */
export type FileTools = {
  readonly list: CourtyardTool;
  readonly read: CourtyardTool;
  readonly search: CourtyardTool;
};

/**
 * Courtyard's tools for coding in a code session's worktree (#248): running a command, and
 * writing or editing a file, each asked of the worker as `CodeTurn` says before it's done. And
 * starting a helper (#470, ADR 0027), for a provider whose own sub-agents can't use them.
 */
export type CodeTools = {
  readonly run: CourtyardTool;
  readonly write: CourtyardTool;
  readonly edit: CourtyardTool;
  readonly helper: CourtyardTool;
  /**
   * What a helper started with `helper` is told: the turn's instructions, and that it's a helper
   * (docs/ai-conduct.md, Courtyard's coding tools). Its task, the model's words, is its message.
   */
  readonly helperInstructions: string;
};

/** Part of what one of Courtyard's tools gives a model: text, or an image. */
export type ToolContent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "image"; readonly dataUrl: string };

/** An image's data URL as its kind and bytes, or `undefined` when it isn't one. */
export const imageOf = (dataUrl: string) => {
  const [, mediaType, data] = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl) ?? [];
  return mediaType === undefined || data === undefined
    ? undefined
    : { mediaType, bytes: Buffer.from(data, "base64") };
};

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
   * Matt Pocock's skills (ADR 0024), for a provider that loads skills itself (Claude, as a local
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
  /**
   * Says a command `run` allowed has finished, however it ended, so a heavy check frees its place
   * in the builds queue (#281). A heavy check's `run` waits for its turn there first; anything a
   * provider doesn't say has ended is freed when the turn ends.
   */
  readonly ran: (command: string) => void;
  /**
   * Starts `command` as a task (#182), when the model asks for it to run in the background: the
   * worker decides it as it decides `run` (the dev and start scripts allowed too, only this way),
   * then runs it itself, on after the turn, and tells the model when it ends. Answers what to tell
   * the model now: that it started, or why it didn't. Only the model's own: a helper is refused.
   */
  readonly task: (command: string, why?: string) => Promise<Result<string, string>>;
  /**
   * Starts a helper the model asked for (#117, ADR 0027), named as the owner sees it: the worker
   * records it, and waits for a place when as many helpers as run at once are running. Answers
   * what the helper does through, each tagged with it, once it has a place; `undefined` when the
   * turn was stopped first. A provider starts helpers only on the turn's model and effort.
   */
  readonly helper: (helper: {
    readonly id: HelperId;
    readonly name: string;
  }) => Promise<HelperTurn | undefined>;
  /**
   * Makes a worktree and branch of its own for a helper that writes code (#395): branched from
   * the session branch's last commit, in a folder beside the session's worktree, never inside the
   * repository. Given to the helper with its `workIn`; or git's reason it couldn't be made.
   */
  readonly branchOff: () => Promise<Result<HelperBranch, string>>;
};

/** The worker's say on a helper's edits and commands (#117), as on the model's. */
export type HelperCode = Omit<CodeTurn, "helper" | "branchOff">;

/**
 * A helper at work inside its code turn (#117): its own copies of the turn's say on edits and
 * commands, its tool connections and its reports, so it follows the session's rules, and what the
 * owner sees of it is tagged with it.
 */
export type HelperTurn = {
  /** Says what the helper is doing, as `TurnInput.report` does for the model. */
  readonly report: (activity: Activity) => Promise<void>;
  /**
   * The worker's say on the helper's edits and commands, as on the model's: in the session's
   * worktree, or, once it works on a branch of its own (`workIn`), in that one's.
   */
  readonly code: HelperCode;
  /** The turn's tool connections, each call the helper makes asked of the worker as its own. */
  readonly connections: readonly ToolConnection[];
  /**
   * Gives the helper the worktree and branch `CodeTurn.branchOff` made (#395): its edits and
   * commands are then decided there, with test ports of its own, and its branch is merged back
   * into the session branch when it finishes.
   */
  readonly workIn: (own: HelperBranch) => Promise<void>;
  /**
   * Says the helper has finished, with its final report, freeing its place. One on its own
   * branch has it merged back first (#395): answers what the model is to be told of that, merged
   * or kept for it to sort, or nothing for a helper that shared the session's worktree.
   */
  readonly finished: (report: string) => Promise<string | undefined>;
};

/** A call to one of a tool connection's tools: the tool by its own name, its input as the model sent it. */
export type ToolCall = { readonly tool: string; readonly input: unknown };

/**
 * A tool connection the turn offers (ADR 0008): an MCP server on the worker machine, such as
 * Paper's (ADR 0023). A provider that uses tools starts its server, offers its tools, asks the
 * worker before every call, does only what's allowed, and hands the worker each call's result.
 */
export type ToolConnection = {
  /** Its name, which is its MCP server's: `paper`. */
  readonly name: string;
  /** Its MCP server: a command on the worker machine, spoken to over its input and output. */
  readonly server: { readonly command: string; readonly args: readonly string[] };
  /**
   * Whether the call may go ahead, or why not. One that needs the owner's approval waits for it
   * (#171), as long as they take.
   */
  readonly check: (call: ToolCall) => Promise<Result<null, string>>;
  /**
   * What an allowed call gave back, or the tool's error when it failed: the worker notes what it
   * made and shows the owner its images. Answers what to add for the model, if anything, such as
   * why a call may have failed.
   */
  readonly done: (
    call: ToolCall & { readonly ok: boolean; readonly content: readonly ToolContent[] },
  ) => Promise<string | undefined>;
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
  /** The tool connections the turn offers, which only a provider that uses tools is given. */
  readonly connections: readonly ToolConnection[];
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
  /**
   * What the owner adds while the turn runs (#252), for a provider that steers
   * (`Capabilities.steers`); `null` for one that doesn't.
   */
  readonly added: AddedMessages | null;
  /**
   * Says what the provider heard of one of its plan windows while the turn ran (#66), such as
   * Claude's `rate_limit_event`, so a window crossing into its warning is known at once.
   */
  readonly heardUsage?: (meter: HeardMeter) => void;
};

/** One plan window as a provider heard it (#66): how much is used, in percent, and when it resets. */
export type HeardMeter = {
  readonly window: UsageWindow;
  readonly used: number;
  readonly resetAt?: string;
};

/**
 * A provider's reading of its plan usage (#66): its windows as far as it knows them and its
 * models' own weekly limits; or that its sign-in has no plan limits (an API key, or none).
 */
export type UsageReading =
  | { readonly kind: "no-plan" }
  | {
      readonly kind: "plan";
      readonly meters: readonly HeardMeter[];
      readonly models: readonly ModelUsageMeter[];
    };

/**
 * A message the owner added while the turn ran (#252): its words as written, by its event number.
 * Or the worker's, saying a task ended (#182), its last lines of output added for the model.
 */
export type AddedMessage = { readonly seq: number; readonly text: string; readonly task?: TaskId };

/**
 * The messages the owner adds while a turn runs (#252), in the order they're sent, for its
 * provider to give its model at the model's next step. The worker records each as it's sent; a
 * provider takes each, says once its model has read it, and says when it takes no more, from when
 * any the owner sends waits in the queue for the next turn instead.
 */
export type AddedMessages = {
  /**
   * The next one the owner adds, waiting for it if none is waiting; `undefined` once the provider
   * takes no more (`done`), or the turn is stopped.
   */
  readonly next: () => Promise<AddedMessage | undefined>;
  /** Those added and not yet taken, taken now, without waiting. */
  readonly waiting: () => readonly AddedMessage[];
  /** Says the model has read this one. */
  readonly read: (added: AddedMessage) => void;
  /** Says the provider takes no more. */
  readonly done: () => void;
};

/**
 * A one-off question outside any session, answered once in the shape `schema` describes, such as
 * a tidy's proposed changes. No tools, no files: the model has only what it's told.
 */
export type OneOffInput = {
  /** What it's for, so the fake can script its answer. */
  readonly purpose: "tidy" | "title" | "quick-question";
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
  /**
   * The model and effort it starts as the default on (#247), until the owner makes another the
   * default; without one, its first model at its own effort.
   */
  readonly startingDefault?: ModelDefault;
  /**
   * The cheap model and effort it runs a short background errand on (#245), such as the note a
   * session leaves (#601, ADR 0032); a provider without one runs none.
   */
  readonly errand?: ModelDefault;
  readonly status: () => Promise<ProviderStatus>;
  readonly runTurn: (input: TurnInput) => Promise<Result<null, FailureReason>>;
  /** Answers a one-off question: the answer unparsed, or why there's none. */
  readonly answerOnce: (input: OneOffInput) => Promise<Result<unknown, FailureReason>>;
  /** Its sign-in, when Courtyard handles it; Claude's is the worker machine's own. */
  readonly signIn?: SignIn;
  /**
   * Reads its plan usage now (#66), or `undefined` when it couldn't. A provider without it has
   * no plan limits to show.
   */
  readonly readUsage?: () => Promise<UsageReading | undefined>;
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

/**
 * The first errand model (#245) on offer with room, on a provider `fits` takes: the provider, the
 * model and its errand's effort, when the model takes it.
 */
export const errandModel = async (
  providers: readonly Provider[],
  fits: (provider: Provider) => boolean = () => true,
) => {
  for (const provider of providers) {
    const { errand } = provider;
    if (errand === undefined || !fits(provider)) continue;
    const offer = await offerFor(providers, { provider: provider.id, model: errand.model });
    if (offer === undefined || offer.model.limit !== undefined) continue;
    const effort = offer.model.efforts.some(({ id }) => id === errand.effort)
      ? errand.effort
      : undefined;
    return { provider, model: offer.model.id, effort };
  }
  return undefined;
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

/** How long a provider's status is reused when it can be used, so listing them doesn't ask each time. */
const GOOD_STATUS_KEPT_MS = 60_000;
/** How long a status saying a provider can't be used is reused: briefly, so a page load soon asks again. */
const FAILED_STATUS_KEPT_MS = 10_000;

/**
 * What one check of a provider's status came to: an answer (available, or not for a reason that
 * holds, such as signed out), or no answer in time, with what to say when there's no good answer to
 * keep.
 */
export type StatusCheck =
  | { readonly kind: "answered"; readonly status: ProviderStatus }
  | { readonly kind: "no-answer"; readonly status: ProviderStatus };

/**
 * A provider's status, checked as seldom as it can be and not lost to a busy machine (#282). A good
 * answer is reused for a minute, one saying the provider can't be used for a few seconds. A check
 * that gets no answer in time keeps the last good answer, models and all, and checks once more in
 * the background; only an answer says the provider can't be used. Callers asking at the same time
 * share one check. `worked` says a turn just finished, which counts as a good check; `forget` says
 * the sign-in changed, so nothing heard before it is kept.
 */
export const createStatusKeeper = (options: {
  check: () => Promise<StatusCheck>;
  now: () => number;
}) => {
  const { check, now } = options;
  let kept: { status: ProviderStatus; until: number } | undefined;
  /** The last answer saying the provider can be used, until one says it can't. */
  let lastGood: ProviderStatus | undefined;
  /** Counts changes to the sign-in, so a check that started before one is never kept. */
  let changes = 0;
  /** The check running now, which callers share, and the change it started after. */
  let checking: { since: number; status: Promise<ProviderStatus> } | undefined;

  const keep = (status: ProviderStatus) => {
    kept = {
      status,
      until: now() + (status.available ? GOOD_STATUS_KEPT_MS : FAILED_STATUS_KEPT_MS),
    };
  };

  /** What a check came to, kept unless the sign-in changed meanwhile. */
  const settle = (since: number, outcome: StatusCheck, inBackground: boolean) => {
    if (since !== changes) return outcome.status;
    if (outcome.kind === "answered") {
      lastGood = outcome.status.available ? outcome.status : undefined;
      keep(outcome.status);
      return outcome.status;
    }
    if (lastGood === undefined) {
      keep(outcome.status);
      return outcome.status;
    }
    keep(lastGood);
    // Once, so a machine that stays busy isn't asked over and over.
    if (!inBackground) start(true);
    return lastGood;
  };

  const start = (inBackground: boolean) => {
    const since = changes;
    const run = { since, status: check().then((outcome) => settle(since, outcome, inBackground)) };
    checking = run;
    // A check that throws is a bug its callers hear about; one in the background has none to.
    void run.status
      .catch(() => undefined)
      .finally(() => {
        if (checking === run) checking = undefined;
      });
    return run;
  };

  return {
    status: async (): Promise<ProviderStatus> => {
      if (kept !== undefined && now() < kept.until) return kept.status;
      const run = checking?.since === changes ? checking : start(false);
      return run.status;
    },
    worked: () => {
      if (lastGood === undefined) kept = undefined;
      else keep(lastGood);
    },
    forget: () => {
      changes += 1;
      kept = undefined;
      lastGood = undefined;
    },
  };
};

/** A schema as Claude Code and Codex's app-server take it: JSON Schema without the `$schema` line. */
export const jsonSchemaOf = (schema: z.ZodType) => {
  const { $schema: _, ...rest } = z.toJSONSchema(schema);
  return rest;
};

export { createClaudeProvider } from "./claude.ts";
export { createCodexProvider } from "./codex.ts";
export { createFakeProvider } from "./fake.ts";
