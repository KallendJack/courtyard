import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  PICK_KINDS,
  PICKS_MAX,
  PickKind,
  ThingSlug,
  type ThingSummary,
  type WantedList,
  WantedPick,
  type WantedRow,
  type WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../../lib/files.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import {
  notOfferedReply,
  PICKS_TOOL,
  PICKS_TOOL_NAME,
  picksReply,
  priceCheckInstructions,
  priceCheckMessage,
} from "../../prompts/index.ts";
import { errandModel, type Provider, type ToolReply } from "../../providers/index.ts";
import { readThings, type ThingRefusal } from "../things/index.ts";
import { getWorkspace } from "../workspaces/index.ts";

/**
 * The wanted list (#245): a planning workspace's Things wanted or to replace, each with up to three
 * picks chosen for value. Picks are found, and their prices checked, by a short background turn on
 * a provider's cheap errand model with web search (docs/ai-conduct.md, The wanted list). They're
 * kept in the data folder (`wanted/<workspace>.json`): found again on the web, they're Courtyard's
 * own state, not a change to the context folder.
 */

/** What's kept for a workspace: each Thing's picks by its file's name, and the day prices were last checked. */
const Kept = z.object({
  picks: z.record(z.string(), z.array(z.unknown())).default({}),
  /** The day (`2026-10-19`) the last weekly check started, so it runs at most once a day. */
  checkedOn: z.string().optional(),
});
type Kept = z.infer<typeof Kept>;

/** A wanted Thing as a price check is given it: its name, make and size, and the picks it has. */
export type CheckedThing = {
  readonly slug: ThingSlug;
  readonly name: string;
  readonly status: WantedRow["status"];
  readonly brand?: string;
  readonly size?: string;
  readonly picks: readonly WantedPick[];
};

/** Why a Thing's picks were refused. */
export type PicksRefusal =
  | { readonly kind: "malformed" }
  | { readonly kind: "unknown-label"; readonly label: string }
  | { readonly kind: "no-best-value" }
  | { readonly kind: "blocked"; readonly shop: string }
  /** A usual price that isn't more than the price: no sale. */
  | { readonly kind: "not-a-sale" }
  | { readonly kind: "invalid"; readonly problem: string }
  | { readonly kind: "stopped" }
  | { readonly kind: "storage" };

/** Why picks weren't found. */
export type FindRefusal =
  | ThingRefusal
  /** It isn't on the wanted list: not there, or had. */
  | { readonly kind: "not-wanted" }
  /** No provider with an errand model that searches the web is on offer. */
  | { readonly kind: "no-model" };

/** The longest a price check may run before it's stopped. */
const CHECK_TIMEOUT_MS = 10 * 60_000;

/** How old a price may get before opening the list checks it again. */
const PRICES_LAST_MS = 7 * 24 * 60 * 60_000;

/** A pick as the picks tool is sent it. */
const PickInput = z.object({
  kind: PickKind,
  product: z.string(),
  why: z.string(),
  price: z.number(),
  usual_price: z.number().optional(),
  shop: z.string(),
  url: z.string(),
  size: z.string().optional(),
});

const PicksInput = z.object({
  thing: z.string(),
  picks: z.array(z.unknown()).min(1).max(PICKS_MAX),
});

/** What each field of a pick is called to the model, when it doesn't fit. */
const PICK_FIELDS: Readonly<Record<string, string>> = {
  product: "product",
  why: "why",
  pence: "price",
  usualPence: "usual price",
  shop: "shop",
  url: "page, an address starting https://,",
  size: "size",
};

/** A pick as sent, checked: pounds become pence, and today is when its price was checked. */
const pickFrom = (raw: unknown, checkedAt: string): Result<WantedPick, PicksRefusal> => {
  const sent = PickInput.safeParse(raw);
  if (!sent.success) return err({ kind: "malformed" });
  const { price, usual_price: usual, ...rest } = sent.data;
  const pence = Math.round(price * 100);
  const usualPence = usual === undefined ? undefined : Math.round(usual * 100);
  if (usualPence !== undefined && usualPence <= pence) return err({ kind: "not-a-sale" });
  const pick = WantedPick.safeParse({
    ...rest,
    pence,
    ...(usualPence === undefined ? {} : { usualPence }),
    checkedAt,
  });
  if (pick.success) return ok(pick.data);
  const field = PICK_FIELDS[String(pick.error.issues[0]?.path[0])] ?? "details";
  return err({ kind: "invalid", problem: `That ${sent.data.kind} pick's ${field} doesn't fit.` });
};

/** A wanted Thing's picks as kept: each that still reads as a pick, one of each kind, ★ first. */
const picksIn = (kept: Kept, slug: ThingSlug): WantedPick[] => {
  const read = (kept.picks[slug] ?? []).flatMap((raw) => {
    const pick = WantedPick.safeParse(raw);
    return pick.success ? [pick.data] : [];
  });
  return PICK_KINDS.flatMap((kind) => read.filter((pick) => pick.kind === kind).slice(0, 1));
};

const isWanted = (thing: ThingSummary): thing is ThingSummary & { status: WantedRow["status"] } =>
  thing.status !== "have";

const sameShop = (a: string, b: string) =>
  a.localeCompare(b, "en-GB", { sensitivity: "base" }) === 0;

export const createWanted = (options: {
  contextDir: string;
  dataDir: string;
  providers: readonly Provider[];
  now: () => number;
  /** Runs work nobody waits for: each price check. */
  background: (work: Promise<void>) => void;
}) => {
  const { contextDir, providers, now } = options;
  const folder = join(options.dataDir, "wanted");
  const fileOf = (workspaceId: WorkspaceId) => join(folder, `${workspaceId}.json`);
  /** The Things whose picks are being found now, as `<workspace>/<slug>`. */
  const finding = new Set<string>();
  /** The workspaces whose prices are being checked now. */
  const checking = new Set<WorkspaceId>();
  /** Each workspace's last change to its kept file, so they happen one at a time. */
  const queues = new Map<WorkspaceId, Promise<unknown>>();

  const read = async (workspaceId: WorkspaceId): Promise<Kept> => {
    const kept = await readJsonFile(fileOf(workspaceId), Kept);
    return kept.ok && kept.value !== undefined ? kept.value : { picks: {} };
  };

  /** Changes a workspace's kept file, after any change to it already under way. */
  const change = <T>(
    workspaceId: WorkspaceId,
    changing: (kept: Kept) => { kept: Kept; answer: T },
  ): Promise<Result<T, "storage">> => {
    const run = (queues.get(workspaceId) ?? Promise.resolve()).then(async () => {
      const { kept, answer } = changing(await read(workspaceId));
      try {
        await mkdir(folder, { recursive: true });
      } catch {
        return err("storage" as const);
      }
      const written = await writeJsonFile(fileOf(workspaceId), kept);
      return written.ok ? ok(answer) : err("storage" as const);
    });
    queues.set(
      workspaceId,
      run.catch(() => undefined),
    );
    return run;
  };

  /** The first errand model on offer with room, on a provider that searches and takes Courtyard's tools. */
  const errand = () =>
    errandModel(
      providers,
      ({ capabilities }) => capabilities.searchesWeb && capabilities.savesContext,
    );

  /** The wanted Things now, as a price check is given them, with the shops the owner blocked. */
  const wantedNow = async (
    workspaceId: WorkspaceId,
  ): Promise<
    Result<{ things: CheckedThing[]; blocked: string[]; folder: string }, ThingRefusal>
  > => {
    const [things, workspace] = await Promise.all([
      readThings({ contextDir, workspaceId }),
      getWorkspace(contextDir, workspaceId),
    ]);
    if (!things.ok) return things;
    if (!workspace.ok) return err({ kind: "workspace", error: workspace.error });
    const kept = await read(workspaceId);
    return ok({
      folder: workspace.value.folder,
      blocked: workspace.value.blockedShops.map(({ shop }) => shop),
      things: things.value.things.flatMap(({ summary }): CheckedThing[] =>
        isWanted(summary)
          ? [
              {
                slug: summary.slug,
                name: summary.name,
                status: summary.status,
                ...(summary.brand === undefined ? {} : { brand: summary.brand }),
                ...(summary.size === undefined ? {} : { size: summary.size }),
                picks: picksIn(kept, summary.slug),
              },
            ]
          : [],
      ),
    });
  };

  /**
   * One short background turn (#245) that finds or checks the picks of these Things: on the
   * errand model, with web search and the picks tool, each call checked and kept as it comes.
   */
  const runCheck = async (check: {
    workspaceId: WorkspaceId;
    workspace: string;
    errand: NonNullable<Awaited<ReturnType<typeof errand>>>;
    things: readonly CheckedThing[];
    blocked: readonly string[];
    folder: string;
  }) => {
    const { workspaceId, things, blocked } = check;
    const signal = AbortSignal.timeout(CHECK_TIMEOUT_MS);
    const savePicks = async (input: unknown): Promise<ToolReply> => {
      if (signal.aborted) return picksReply(err({ kind: "stopped" }));
      const sent = PicksInput.safeParse(input);
      if (!sent.success) return picksReply(err({ kind: "malformed" }));
      const label = sent.data.thing.replace(/[[\]\s]/g, "").toUpperCase();
      const thing = things[Number(/^W(\d+)$/.exec(label)?.[1] ?? 0) - 1];
      if (thing === undefined) return picksReply(err({ kind: "unknown-label", label }));
      const checkedAt = new Date(now()).toISOString();
      const picks: WantedPick[] = [];
      for (const raw of sent.data.picks) {
        const pick = pickFrom(raw, checkedAt);
        if (!pick.ok) return picksReply(pick);
        if (picks.some(({ kind }) => kind === pick.value.kind)) {
          return picksReply(err({ kind: "malformed" }));
        }
        const shop = blocked.find((one) => sameShop(one, pick.value.shop));
        if (shop !== undefined) return picksReply(err({ kind: "blocked", shop }));
        picks.push(pick.value);
      }
      if (!picks.some(({ kind }) => kind === "best-value")) {
        return picksReply(err({ kind: "no-best-value" }));
      }
      const kept = await change(workspaceId, (was) => ({
        kept: { ...was, picks: { ...was.picks, [thing.slug]: picks } },
        answer: null,
      }));
      if (!kept.ok) return picksReply(err({ kind: "storage" }));
      return picksReply(ok({ label, name: thing.name, count: picks.length }));
    };
    const message = priceCheckMessage({ things, blocked });
    const turn = await check.errand.provider.runTurn({
      model: check.errand.model,
      effort: check.errand.effort,
      folder: check.folder,
      code: null,
      connections: [],
      framing: {
        instructions: priceCheckInstructions({ workspace: check.workspace, now: now() }),
        message,
        newMessage: message,
        attachments: [],
        tools: [PICKS_TOOL],
        fileTools: null,
        codeTools: null,
        webSearch: { ownerLinks: [] },
      },
      emit: async () => {},
      report: async () => {},
      cite: async () => {},
      callTool: async ({ name, input }) =>
        name === PICKS_TOOL_NAME ? savePicks(input) : notOfferedReply(name),
      signal,
      added: null,
    });
    if (!turn.ok) {
      console.error(`The ${workspaceId} wanted list's price check failed: ${turn.error.kind}`);
    }
  };

  /** Starts a check of these Things' picks in the background, marking them while it runs. */
  const startCheck = async (start: {
    workspaceId: WorkspaceId;
    slugs: readonly ThingSlug[] | "stale";
  }): Promise<Result<null, FindRefusal>> => {
    const { workspaceId } = start;
    const model = await errand();
    if (model === undefined) return err({ kind: "no-model" });
    const wanted = await wantedNow(workspaceId);
    if (!wanted.ok) return wanted;
    const workspace = await getWorkspace(contextDir, workspaceId);
    if (!workspace.ok) return err({ kind: "workspace", error: workspace.error });
    const weekly = start.slugs === "stale";
    const things = wanted.value.things.filter((thing) =>
      start.slugs === "stale" ? isStale(thing) : start.slugs.includes(thing.slug),
    );
    if (things.length === 0) return ok(null);
    const marks = things.map(({ slug }) => `${workspaceId}/${slug}`);
    if (weekly) checking.add(workspaceId);
    else for (const mark of marks) finding.add(mark);
    options.background(
      runCheck({
        workspaceId,
        workspace: workspace.value.summary.name,
        errand: model,
        things,
        blocked: wanted.value.blocked,
        folder: wanted.value.folder,
      })
        .catch((error: unknown) => console.error("A wanted list's price check crashed", error))
        .finally(() => {
          if (weekly) checking.delete(workspaceId);
          else for (const mark of marks) finding.delete(mark);
        }),
    );
    return ok(null);
  };

  /** Whether a Thing's picks have a price older than a week. */
  const isStale = (thing: CheckedThing) =>
    thing.picks.some(({ checkedAt }) => now() - Date.parse(checkedAt) > PRICES_LAST_MS);

  /** The wanted list as it is now. */
  const listNow = async (workspaceId: WorkspaceId): Promise<Result<WantedList, ThingRefusal>> => {
    const things = await readThings({ contextDir, workspaceId });
    if (!things.ok) return err(things.error);
    const kept = await read(workspaceId);
    const rows = things.value.things.flatMap(({ summary }): WantedRow[] =>
      isWanted(summary)
        ? [
            {
              thing: summary.slug,
              name: summary.name,
              status: summary.status,
              picks: picksIn(kept, summary.slug),
              finding: finding.has(`${workspaceId}/${summary.slug}`),
            },
          ]
        : [],
    );
    return ok({ rows, checking: checking.has(workspaceId) });
  };

  return {
    list: listNow,

    /** Each wanted Thing's picks by its file's name, ★ first, for a session's turn. */
    picksOf: async (
      workspaceId: WorkspaceId,
    ): Promise<ReadonlyMap<string, readonly WantedPick[]>> => {
      const kept = await read(workspaceId);
      const picks = new Map<string, readonly WantedPick[]>();
      for (const slug of Object.keys(kept.picks)) {
        const named = ThingSlug.safeParse(slug);
        const some = named.success ? picksIn(kept, named.data) : [];
        if (named.success && some.length > 0) picks.set(named.data, some);
      }
      return picks;
    },

    /** A shop was blocked: each wanted Thing with a pick from it gets its picks found again. */
    shopBlocked: async (workspaceId: WorkspaceId, shop: string) => {
      const wanted = await wantedNow(workspaceId);
      if (!wanted.ok) return;
      const slugs = wanted.value.things
        .filter((thing) => thing.picks.some((pick) => sameShop(pick.shop, shop)))
        .map(({ slug }) => slug);
      if (slugs.length > 0) await startCheck({ workspaceId, slugs });
    },

    /**
     * The owner opened the list: prices over a week old are checked again, quietly, at most once
     * a day per workspace, whether or not the check finds anything.
     */
    opened: async (workspaceId: WorkspaceId) => {
      if (checking.has(workspaceId)) return;
      const today = new Date(now()).toISOString().slice(0, 10);
      if ((await read(workspaceId)).checkedOn === today) return;
      const wanted = await wantedNow(workspaceId);
      if (!wanted.ok || !wanted.value.things.some(isStale)) return;
      const marked = await change(workspaceId, (kept) => ({
        kept: { ...kept, checkedOn: today },
        answer: null,
      }));
      if (marked.ok) await startCheck({ workspaceId, slugs: "stale" });
    },

    /** Finds a wanted Thing's picks in the background (Find picks): the list as it is then. */
    find: async (
      workspaceId: WorkspaceId,
      slug: ThingSlug,
    ): Promise<Result<WantedList, FindRefusal>> => {
      const before = await listNow(workspaceId);
      if (!before.ok) return before;
      if (!before.value.rows.some((row) => row.thing === slug)) return err({ kind: "not-wanted" });
      if (!finding.has(`${workspaceId}/${slug}`)) {
        const started = await startCheck({ workspaceId, slugs: [slug] });
        if (!started.ok) return started;
      }
      return listNow(workspaceId);
    },
  };
};

export type Wanted = ReturnType<typeof createWanted>;
