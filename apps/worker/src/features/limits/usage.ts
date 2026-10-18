import { join } from "node:path";
import {
  type ModelUsageMeter,
  type PlanUsage,
  ProviderId,
  type ProviderUsage,
  type SessionId,
  USAGE_WARNS_AT,
  type UsageList,
  UsageWindow,
  usageWindowWords,
} from "@courtyard/contract";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../../lib/files.ts";
import { createOneAtATime } from "../../lib/one-at-a-time.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import type { HeardMeter, Provider } from "../../providers/index.ts";
import { type PutOff, usageWarnings } from "../waiting/index.ts";

/** The least time between two readings of one provider's usage (#66). */
const READ_EVERY_MS = 60 * 1000;
/** How long each window lasts, for putting one off whose reset time isn't known. */
const WINDOW_MS: Record<UsageWindow, number> = {
  "five-hour": 5 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};
/** Every provider shows these, in this order, each "not known yet" until it's read or heard. */
const WINDOWS: readonly UsageWindow[] = ["five-hour", "weekly"];

/** Where the warnings put off with Not now are kept, in the data folder, across restarts. */
const PUT_OFF_FILE = "usage-not-now.json";
const PutOffFile = z.object({
  putOff: z.array(
    z.object({
      provider: ProviderId,
      window: UsageWindow,
      until: z.number(),
      used: z.number(),
    }),
  ),
});

/** What Not now couldn't do. */
export type NotNowProblem = { readonly kind: "unknown-provider" } | { readonly kind: "storage" };

/** One provider's usage as last known: its plan or none, each window and when it was heard. */
type Known = {
  plan: boolean | undefined;
  meters: Map<UsageWindow, HeardMeter>;
  models: readonly ModelUsageMeter[];
  readAt: number | undefined;
};

/**
 * Usage at a glance (#66): each provider's plan usage as last known, in the worker's memory. It's
 * read from each provider as the worker starts and every 15 minutes, after every turn ends and
 * when the Model sheet opens, at most once a minute per provider; a turn adds what its provider hears as it runs. A
 * reading that fails keeps what was heard, and a window never heard is "not known yet". The
 * warnings are decided by `waiting/`; those put off with Not now are kept in the data folder.
 * A window crossing `USAGE_WARNS_AT` while a turn runs notifies the owner, once per window until
 * it resets.
 */
export const createUsage = (options: {
  providers: readonly Provider[];
  dataDir: string;
  now: () => number;
  /** Tells the owner what a session's turn crossed (#173), opening that session. */
  notify: (session: SessionId, need: () => Promise<string>) => void;
}) => {
  const { providers, now } = options;
  const known = new Map<ProviderId, Known>();
  const lastRead = new Map<ProviderId, number>();
  const reading = new Map<ProviderId, Promise<void>>();
  /** Each window the owner was told of, by provider and window, with the reset it was for. */
  const told = new Map<string, string | undefined>();
  const file = join(options.dataDir, PUT_OFF_FILE);
  const oneAtATime = createOneAtATime();

  const knownOf = (provider: ProviderId) => {
    const found = known.get(provider);
    if (found !== undefined) return found;
    const fresh: Known = { plan: undefined, meters: new Map(), models: [], readAt: undefined };
    known.set(provider, fresh);
    return fresh;
  };

  /** Reads one provider's usage now, unless it was read under a minute ago or is being read. */
  const readOne = (provider: Provider): Promise<void> => {
    const { readUsage } = provider;
    if (readUsage === undefined) return Promise.resolve();
    const running = reading.get(provider.id);
    if (running !== undefined) return running;
    const last = lastRead.get(provider.id);
    if (last !== undefined && now() - last < READ_EVERY_MS) return Promise.resolve();
    lastRead.set(provider.id, now());
    const read = (async () => {
      const status = await provider.status();
      // Not signed in: nothing to read, and no plan limits to show.
      if (!status.available) return;
      const reading = await readUsage();
      if (reading === undefined) return;
      const kept = knownOf(provider.id);
      kept.readAt = now();
      if (reading.kind === "no-plan") {
        kept.plan = false;
        return;
      }
      kept.plan = true;
      for (const meter of reading.meters) kept.meters.set(meter.window, meter);
      kept.models = reading.models;
    })()
      .catch((error: unknown) => console.error(`${provider.id}'s usage couldn't be read`, error))
      .finally(() => reading.delete(provider.id));
    reading.set(provider.id, read);
    return read;
  };

  /** Reads every provider's usage, or `only` that one's, each at most once a minute. */
  const read = async (only?: ProviderId) => {
    await Promise.all(
      providers.filter((each) => only === undefined || each.id === only).map(readOne),
    );
  };

  /** A provider's usage as shown: no plan, or each window as last known. */
  const usageOf = async (provider: Provider): Promise<PlanUsage> => {
    const kept = known.get(provider.id);
    if (provider.readUsage === undefined || kept?.plan === false) return { kind: "no-plan" };
    if (!(await provider.status()).available) return { kind: "no-plan" };
    const clock = now();
    return {
      kind: "plan",
      meters: WINDOWS.map((window) => {
        const meter = kept?.meters.get(window);
        // A window past its reset is no longer known until it's read again: never a guess.
        const reset = meter?.resetAt !== undefined && Date.parse(meter.resetAt) <= clock;
        return meter === undefined || reset
          ? { window, used: null }
          : {
              window,
              used: meter.used,
              ...(meter.resetAt === undefined ? {} : { resetAt: meter.resetAt }),
            };
      }),
      models: [...(kept?.models ?? [])],
      ...(kept?.readAt === undefined ? {} : { readAt: new Date(kept.readAt).toISOString() }),
    };
  };

  const readPutOff = async (): Promise<Result<PutOff[], "storage">> => {
    const read = await readJsonFile(file, PutOffFile);
    return read.ok ? ok(read.value?.putOff ?? []) : err("storage");
  };

  const list = async (): Promise<UsageList> => {
    const usage: ProviderUsage[] = await Promise.all(
      providers.map(async (provider) => ({
        provider: provider.id,
        label: (await provider.status()).label,
        usage: await usageOf(provider),
      })),
    );
    const statuses = await Promise.all(providers.map((provider) => provider.status()));
    const putOff = await readPutOff();
    return {
      providers: usage,
      warnings: usageWarnings({
        usage,
        statuses,
        // One that can't be read puts nothing off: the warning shows rather than hides.
        putOff: putOff.ok ? putOff.value : [],
        clock: now(),
      }),
    };
  };

  return {
    read,
    list,

    /**
     * What a provider heard of a window while a session's turn ran: kept at once, and the owner
     * told once if it crossed into its warning.
     */
    heard: (session: SessionId, provider: ProviderId, meter: HeardMeter) => {
      const kept = knownOf(provider);
      const clock = now();
      const before = kept.meters.get(meter.window);
      // What was known of a window past its reset says nothing of it now.
      const was =
        before?.resetAt !== undefined && Date.parse(before.resetAt) <= clock ? undefined : before;
      kept.plan = true;
      kept.meters.set(meter.window, {
        ...meter,
        ...(meter.resetAt === undefined && was?.resetAt !== undefined
          ? { resetAt: was.resetAt }
          : {}),
      });
      kept.readAt = clock;
      const crossed =
        meter.used >= USAGE_WARNS_AT && (was === undefined || was.used < USAGE_WARNS_AT);
      const key = `${provider}:${meter.window}`;
      const resetAt = meter.resetAt ?? was?.resetAt;
      if (!crossed || (told.has(key) && told.get(key) === resetAt)) return;
      told.set(key, resetAt);
      const found = providers.find((each) => each.id === provider);
      options.notify(session, async () => {
        const name = (await found?.status())?.label ?? provider;
        return `${name}: ${Math.round(meter.used)}% of ${usageWindowWords(meter.window)} used`;
      });
    },

    /**
     * Not now (#66): puts off a provider's warning until its window resets, or until it passes
     * `USAGE_WARNS_AGAIN_AT`, when it comes back once. Answers the usage as it now shows.
     */
    notNow: async (rawProvider: string): Promise<Result<UsageList, NotNowProblem>> => {
      const id = ProviderId.safeParse(rawProvider);
      if (!id.success || !providers.some((provider) => provider.id === id.data)) {
        return err({ kind: "unknown-provider" });
      }
      const changed = await oneAtATime(async (): Promise<Result<null, NotNowProblem>> => {
        const warning = (await list()).warnings.find((each) => each.provider === id.data);
        if (warning === undefined) return ok(null);
        const putOff = await readPutOff();
        if (!putOff.ok) return err({ kind: "storage" });
        const clock = now();
        const written = await writeJsonFile(file, {
          putOff: [
            // Those that have run out, and this window's last, go.
            ...putOff.value.filter(
              (each) =>
                each.until > clock &&
                !(each.provider === warning.provider && each.window === warning.window),
            ),
            {
              provider: warning.provider,
              window: warning.window,
              until:
                warning.resetAt === undefined
                  ? clock + WINDOW_MS[warning.window]
                  : Date.parse(warning.resetAt),
              used: warning.used,
            },
          ],
        } satisfies z.infer<typeof PutOffFile>);
        return written.ok ? ok(null) : err({ kind: "storage" });
      });
      return changed.ok ? ok(await list()) : changed;
    },
  };
};

export type Usage = ReturnType<typeof createUsage>;
