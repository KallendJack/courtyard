import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";

/**
 * The machine's builds lock (#306): one lock for every heavy check on a machine, whoever starts
 * it, so Courtyard's code sessions and the builds run beside them (a helper's `pnpm verify`) queue
 * behind each other rather than lock the machine up together. It's a folder with a file for each
 * place taken, up to `atOnce` of them, each made only if it isn't there yet and naming its
 * holder's process, so a place whose process has gone (one that crashed) is cleared by the next
 * one waiting, and nothing waits for ever. The worker takes it for its sessions' builds
 * (`code/builds.ts`), and `scripts/builds/run.ts` for the repo's own `verify`, `test`, `e2e` and
 * `build` scripts.
 */

/** Where a place is taken, and how many may be taken at once. */
export type BuildsLock = { readonly dir: string; readonly atOnce: number };

/**
 * What a command gets from whatever already holds a place for it (the script, or the worker for
 * a session's build), so a `pnpm verify` running `pnpm e2e` doesn't wait on its own place.
 */
export const HELD_ENV = { COURTYARD_BUILD_HELD: "1" } as const;

/** Whether the environment says a place is already held for this run. */
export const placeHeldIn = (env: Readonly<Record<string, string | undefined>>) =>
  env.COURTYARD_BUILD_HELD === HELD_ENV.COURTYARD_BUILD_HELD;

const NOT_A_COUNT = "must be a whole number, 1 or more";
const unsetIfEmpty = (value: unknown) => (value === "" ? undefined : value);

/**
 * The lock's settings, read from the environment by the worker and the script alike: how many
 * builds at once (1 unless a stronger machine allows more), and the lock's folder, the same for
 * everyone on the machine unless a test moves it.
 */
export const BuildsSettings = z.object({
  COURTYARD_BUILDS_AT_ONCE: z.preprocess(
    unsetIfEmpty,
    z.coerce.number({ error: NOT_A_COUNT }).int(NOT_A_COUNT).min(1, NOT_A_COUNT).default(1),
  ),
  COURTYARD_BUILDS_LOCK_DIR: z.preprocess(
    unsetIfEmpty,
    z
      .string()
      .default(join(tmpdir(), "courtyard-builds"))
      .transform((dir) => resolve(dir)),
  ),
});

/** The lock the settings name. */
export const buildsLockOf = (settings: z.output<typeof BuildsSettings>): BuildsLock => ({
  dir: settings.COURTYARD_BUILDS_LOCK_DIR,
  atOnce: settings.COURTYARD_BUILDS_AT_ONCE,
});

/** A place's file: who holds it and since when, and a token only its holder knows. */
const Holding = z.object({
  pid: z.number().int().positive(),
  label: z.string(),
  since: z.iso.datetime(),
  token: z.string(),
});
type Holding = z.infer<typeof Holding>;

/** Who holds a place, as a waiting run says it: a label, and when they took it. */
export type Holder = { readonly label: string; readonly since: Date };

/** A place taken, until it's freed. Freeing twice, or after it was cleared, does nothing. */
export type Place = { readonly free: () => void };

/** How often a run waiting for a place looks again. */
const EVERY_MS = 500;
/** How long a run that cleared a crashed holder's place waits before making sure it's its own. */
const SETTLE_MS = 100;
/** How old a place's file that can't be read gets before it counts as a crash's. */
const UNREADABLE_FOR_MS = 10_000;

/** What's in a place's file: nothing, or what it says (`null` when it can't be read). */
type Seen =
  | { readonly kind: "free" }
  | {
      readonly kind: "held";
      readonly raw: string;
      readonly holding: Holding | null;
      readonly at: Date;
    };

const codeOf = (error: unknown) =>
  error instanceof Error && "code" in error ? String(error.code) : undefined;

const look = (path: string): Seen => {
  try {
    const raw = readFileSync(path, "utf8");
    const at = statSync(path).mtime;
    let holding: Holding | null = null;
    try {
      const parsed = Holding.safeParse(JSON.parse(raw));
      if (parsed.success) holding = parsed.data;
    } catch {
      // Being written, or broken: unreadable, below.
    }
    return { kind: "held", raw, holding, at };
  } catch (error) {
    if (codeOf(error) === "ENOENT") return { kind: "free" };
    // Being freed or made as it was read (Windows says so): held, for now.
    return { kind: "held", raw: "", holding: null, at: new Date() };
  }
};

/** Whether a process is still running: one that's there but not ours to signal still counts. */
const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return codeOf(error) === "EPERM";
  }
};

/** Whether a place's holder has gone, so the place can be cleared. */
const isLeftBehind = (seen: Seen & { kind: "held" }) =>
  seen.holding === null
    ? seen.raw !== "" && Date.now() - seen.at.getTime() > UNREADABLE_FOR_MS
    : !isRunning(seen.holding.pid);

const holderOf = (seen: Seen & { kind: "held" }): Holder =>
  seen.holding === null
    ? { label: "another build", since: seen.at }
    : { label: seen.holding.label, since: new Date(seen.holding.since) };

const removeFile = (path: string) => {
  try {
    unlinkSync(path);
  } catch {
    // Already gone, or going.
  }
};

/** Makes a place's file only if it isn't there: `false` when someone else's is. */
const makeFile = (path: string, text: string) => {
  try {
    writeFileSync(path, text, { flag: "wx" });
    return true;
  } catch {
    return false;
  }
};

/** Frees a place only while it's still its holder's, so a run never frees someone else's. */
const placeAt = (path: string, token: string): Place => ({
  free: () => {
    const seen = look(path);
    if (seen.kind === "held" && seen.holding?.token === token) removeFile(path);
  },
});

/** Takes a free place, clearing any a crashed holder left, or says who holds them all. */
const tryTake = async (
  lock: BuildsLock,
  label: string,
): Promise<{ place: Place } | { holders: Holder[] }> => {
  mkdirSync(lock.dir, { recursive: true });
  const holders: Holder[] = [];
  for (let number = 1; number <= lock.atOnce; number += 1) {
    const path = join(lock.dir, `place-${number}.json`);
    const seen = look(path);
    const cleared = seen.kind === "held" && isLeftBehind(seen);
    if (seen.kind === "held" && !cleared) {
      holders.push(holderOf(seen));
      continue;
    }
    // Cleared only if it's still the one that was left behind, not another run's new place.
    if (seen.kind === "held") {
      const again = look(path);
      if (again.kind === "held" && again.raw === seen.raw) removeFile(path);
    }
    const mine: Holding = {
      pid: process.pid,
      label,
      since: new Date().toISOString(),
      token: randomUUID(),
    };
    if (makeFile(path, JSON.stringify(mine))) {
      // Two runs clearing the same place at once can each think they took it: the one whose file
      // is there once both are done has it.
      if (cleared) await sleep(SETTLE_MS);
      const after = look(path);
      if (after.kind === "held" && after.holding?.token === mine.token) {
        return { place: placeAt(path, mine.token) };
      }
    }
    const now = look(path);
    if (now.kind === "held") holders.push(holderOf(now));
  }
  return { holders };
};

/**
 * Who holds a place in the lock now, taking none and clearing none: a place whose holder has gone
 * counts as free. A waiting Update waits while anyone does (#629).
 */
export const holdersOf = (lock: BuildsLock): Holder[] => {
  const holders: Holder[] = [];
  for (let number = 1; number <= lock.atOnce; number += 1) {
    const seen = look(join(lock.dir, `place-${number}.json`));
    if (seen.kind === "held" && !isLeftBehind(seen)) holders.push(holderOf(seen));
  }
  return holders;
};

/**
 * Waits for a place in the lock and takes it, labelled for anyone waiting behind it (a session's
 * id, or `helper <folder>`). Tells `waiting` who holds the places each time that changes while it
 * waits. `null` when `signal` stops it first.
 */
export const takePlace = async (
  lock: BuildsLock,
  options: {
    label: string;
    signal?: AbortSignal;
    waiting?: (holders: readonly Holder[]) => void;
  },
): Promise<Place | null> => {
  const { signal } = options;
  let told = "";
  while (!signal?.aborted) {
    const tried = await tryTake(lock, options.label);
    if ("place" in tried) {
      if (!signal?.aborted) return tried.place;
      tried.place.free();
      break;
    }
    const holders = JSON.stringify(tried.holders);
    if (tried.holders.length > 0 && holders !== told) {
      told = holders;
      options.waiting?.(tried.holders);
    }
    try {
      await sleep(EVERY_MS, undefined, signal === undefined ? {} : { signal });
    } catch {
      break;
    }
  }
  return null;
};
