import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { type ContextBackup, WorkspaceId } from "@courtyard/contract";
import { isFolder } from "../files.ts";
import { OWNER_FILE } from "../owner-context/index.ts";
import type { Result } from "../result.ts";
import { ARCHIVED_FOLDER } from "../workspaces/index.ts";

/**
 * What kind of change a commit is, as its `Courtyard-Change` trailer says: the repository's
 * start, the owner's own edits, a workspace made, renamed, recoloured or archived in the app, or
 * the owner context started from the app.
 */
export type ChangeKind = "setup" | "hand-edit" | "workspace" | "owner-context";

/** Where a change was made: a workspace, or the owner context. */
export type Place = { readonly workspace: WorkspaceId } | "owner-context";

/** One change, as its commit describes it. */
export type ChangeNote = {
  readonly kind: ChangeKind;
  readonly title: string;
  readonly places: readonly Place[];
};

const run = promisify(execFile);

/**
 * Git in the context folder. Commits are Courtyard's own, never the owner's git identity or
 * signing, and git never stops to ask for a password.
 */
const gitIn =
  (folder: string) =>
  async (...args: string[]) =>
    (
      await run(
        "git",
        [
          "-c",
          "user.name=Courtyard",
          "-c",
          "user.email=courtyard@courtyard.invalid",
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        { cwd: folder, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      )
    ).stdout.trim();

const placeTrailer = (place: Place) =>
  `Courtyard-Place: ${place === "owner-context" ? place : `workspace/${place.workspace}`}`;

/** Where a file in the context folder belongs, by its path from the folder's top. */
const placeOf = (path: string): Place | undefined => {
  const [first, second] = path.split("/");
  if (first === OWNER_FILE && second === undefined) return "owner-context";
  const folder = first === ARCHIVED_FOLDER ? second : first;
  const workspace = WorkspaceId.safeParse(folder);
  return workspace.success && path.includes("/") ? { workspace: workspace.data } : undefined;
};

/** The places these paths belong to, each once, in order. */
const placesOf = (paths: readonly string[]): Place[] => {
  const byTrailer = new Map<string, Place>();
  for (const path of paths) {
    const place = placeOf(path);
    if (place !== undefined) byTrailer.set(placeTrailer(place), place);
  }
  return [...byTrailer.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, place]) => place);
};

/** A commit message's title, then its trailers, which Recent changes reads back. */
const messageFor = (note: ChangeNote) => [
  "-m",
  note.title,
  "-m",
  [`Courtyard-Change: ${note.kind}`, ...note.places.map(placeTrailer)].join("\n"),
];

/** The name the context folder's repository knows its backup by. */
const REMOTE = "backup";

/** What went wrong with a git command, in git's own words: its first error line. */
const reasonFor = (error: unknown) => {
  const stderr = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const first = lines.find((line) => /^(fatal|error):/.test(line)) ?? lines[0];
  return first?.replace(/^(fatal|error):\s*/, "") ?? "Git couldn't run.";
};

export type ContextFolder = {
  /**
   * Makes a change to the context folder, after every change asked for before it, and commits
   * what it changed as one change, described by `describe`. Nothing is committed for a change
   * that fails. The change's own result is returned either way.
   */
  change<T, E>(
    make: () => Promise<Result<T, E>>,
    describe: (made: T) => ChangeNote,
  ): Promise<Result<T, E>>;
  /** Whether the backup has every change, once the changes asked for so far are made. */
  backup(): Promise<ContextBackup>;
  /** Sets the repository up if it isn't yet. Run at start and every so often. */
  keepUp(): Promise<void>;
};

/** The context folder as a git repository the worker looks after (ADRs 0009, 0014). */
export const createContextFolder = (options: {
  contextDir: string;
  /** The backup's git remote, or `null` for none. */
  remote: string | null;
}): ContextFolder => {
  const { contextDir, remote } = options;
  const git = gitIn(contextDir);
  /** The last job in line: each one waits for the one before, so git never runs twice at once. */
  let queue: Promise<unknown> = Promise.resolve();

  const inTurn = <T>(job: () => Promise<T>) => {
    const done = queue.then(job, job);
    queue = done.catch(() => undefined);
    return done;
  };

  /** Stages everything, and returns the paths staged (both sides of a move). */
  const stageAll = async () => {
    await git("add", "--all");
    const names = await git("diff", "--cached", "--name-only", "--no-renames", "-z");
    return names.split("\0").filter((name) => name !== "");
  };

  const commit = async (note: ChangeNote) => {
    if ((await stageAll()).length === 0) return;
    await git("commit", "--quiet", ...messageFor(note));
  };

  /** Commits whatever changed since the last change: the owner's own edits. */
  const commitHandEdits = async () => {
    const paths = await stageAll();
    if (paths.length === 0) return;
    await git(
      "commit",
      "--quiet",
      ...messageFor({ kind: "hand-edit", title: "Edited by hand", places: placesOf(paths) }),
    );
  };

  /** Why the last push failed, until one succeeds. */
  let pushFailure: string | undefined;

  const branch = () => git("symbolic-ref", "--short", "HEAD");

  /** Points the `backup` remote at the setting, which may have changed since the last start. */
  const pointAtRemote = async (url: string) => {
    const current = await git("remote", "get-url", REMOTE).catch(() => undefined);
    if (current === url) return;
    await git("remote", current === undefined ? "add" : "set-url", REMOTE, url);
  };

  const push = async () => {
    if (remote === null) return;
    try {
      await pointAtRemote(remote);
      await git("push", "--quiet", REMOTE, await branch());
      pushFailure = undefined;
    } catch (error) {
      pushFailure = reasonFor(error);
    }
  };

  /** The commits the backup doesn't have yet, oldest first. */
  const unpushed = async () => {
    const tracking = `refs/remotes/${REMOTE}/${await branch()}`;
    const pushedBefore = await git("rev-parse", "--verify", "--quiet", tracking).catch(() => "");
    const range = pushedBefore === "" ? ["HEAD"] : [`${tracking}..HEAD`];
    const commits = await git("rev-list", "--reverse", ...range);
    return commits.split("\n").filter((commit) => commit !== "");
  };

  const setUp = async () => {
    const isRepository = await isFolder(join(contextDir, ".git"));
    if (isRepository.ok && isRepository.value) return;
    await git("init", "--quiet", "--initial-branch=main");
    await git("add", "--all");
    await git(
      "commit",
      "--quiet",
      "--allow-empty",
      ...messageFor({
        kind: "setup",
        title: "Start keeping the context folder in git",
        places: [],
      }),
    );
  };

  /** Why git last couldn't keep a change, until it next can. */
  let gitFailure: string | undefined;

  /**
   * Runs git work, noting why it failed rather than failing whatever asked for it: a change the
   * owner made is still made when git can't keep it.
   */
  const keeping = async (job: () => Promise<void>) => {
    try {
      await job();
      gitFailure = undefined;
      return true;
    } catch (error) {
      gitFailure = reasonFor(error);
      return false;
    }
  };

  const ready = async () => {
    await setUp();
    await commitHandEdits();
  };

  const backupNow = async (): Promise<ContextBackup> => {
    if (remote === null) return { kind: "not-set-up" };
    const [oldest] = await unpushed();
    if (oldest === undefined) return { kind: "up-to-date" };
    return {
      kind: "behind",
      since: await git("log", "-1", "--format=%cI", oldest),
      reason: pushFailure ?? "It hasn't been backed up yet.",
    };
  };

  return {
    change: (make, describe) =>
      inTurn(async () => {
        const isReady = await keeping(ready);
        const made = await make();
        if (!made.ok || !isReady) return made;
        await keeping(() => commit(describe(made.value)));
        // Pushed in turn, without keeping the change waiting for the backup.
        void inTurn(push);
        return made;
      }),
    backup: () =>
      inTurn(async (): Promise<ContextBackup> => {
        if (gitFailure !== undefined) return { kind: "not-kept", reason: gitFailure };
        try {
          return await backupNow();
        } catch (error) {
          return { kind: "not-kept", reason: reasonFor(error) };
        }
      }),
    keepUp: () =>
      inTurn(async () => {
        await keeping(async () => {
          await ready();
          if (remote !== null && (await unpushed()).length > 0) await push();
        });
      }),
  };
};
