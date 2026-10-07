import { join } from "node:path";
import {
  ChangeId,
  type ContextBackup,
  RecentChangeKind,
  SessionId,
  WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";
import { exists } from "../files.ts";
import { git, gitBytes, gitFailureReason } from "../git.ts";
import { OWNER_FILE } from "../owner-context/index.ts";
import { err, ok, type Result } from "../result.ts";
import { ARCHIVED_FOLDER, CONTEXT_FILE } from "../workspaces/index.ts";

/**
 * What kind of change a commit is, as its `Courtyard-Change` trailer says: the repository's
 * start, the owner's own edits, a workspace made, renamed, recoloured or archived in the app, the
 * owner context started from the app, or a model's save and the owner undoing or editing one.
 */
export const ChangeKind = z.enum([
  "setup",
  "hand-edit",
  "workspace",
  "owner-context",
  "save",
  "undo",
  "edit",
]);
export type ChangeKind = z.infer<typeof ChangeKind>;

/** Where a change was made: a workspace, or the owner context. */
export type Place =
  | { readonly kind: "workspace"; readonly id: WorkspaceId }
  | { readonly kind: "owner-context" };

/** One change, as its commit describes it. */
export type ChangeNote = {
  readonly kind: ChangeKind;
  readonly title: string;
  readonly places: readonly Place[];
  /** The session it came from, for a save and what the owner did with it. */
  readonly session?: SessionId;
};

/** A workspace made, renamed, recoloured or archived in the app. */
export const workspaceChange = (title: string, id: WorkspaceId): ChangeNote => ({
  kind: "workspace",
  title,
  places: [{ kind: "workspace", id }],
});

/** Commits are Courtyard's own, never the owner's git identity or signing. */
const AS_COURTYARD = [
  "user.name=Courtyard",
  "user.email=courtyard@courtyard.invalid",
  "commit.gpgsign=false",
];

/** The name the context folder's repository knows its backup by. */
const REMOTE = "backup";

/** A push still going after this long is given up on, and tried again later. */
const PUSH_GIVES_UP_MS = 60 * 1000;

const placeTrailer = (place: Place) =>
  `Courtyard-Place: ${place.kind === "workspace" ? `workspace/${place.id}` : "owner-context"}`;

/**
 * Where a file in the context folder belongs, by its path from the folder's top: the owner
 * context, a workspace (archived or not), or nowhere in particular.
 */
const placeOf = (path: string): Place | undefined => {
  const [first, second] = path.split("/");
  if (first === OWNER_FILE && second === undefined) return { kind: "owner-context" };
  if (second === undefined) return undefined;
  const id = WorkspaceId.safeParse(first === ARCHIVED_FOLDER ? second : first);
  return id.success ? { kind: "workspace", id: id.data } : undefined;
};

/** The places these paths belong to, each once, in trailer order. */
const placesOf = (paths: readonly string[]): Place[] => {
  const byTrailer = new Map<string, Place>();
  for (const path of paths) {
    const place = placeOf(path);
    if (place !== undefined) byTrailer.set(placeTrailer(place), place);
  }
  return [...byTrailer.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, place]) => place);
};

/** `git commit` arguments for a change: its title, then its trailers, which Recent changes reads. */
const commitMessageArgs = (note: ChangeNote) => [
  "-m",
  note.title,
  "-m",
  [
    `Courtyard-Change: ${note.kind}`,
    ...note.places.map(placeTrailer),
    ...(note.session === undefined ? [] : [`Courtyard-Session: ${note.session}`]),
  ].join("\n"),
];

export type ContextFolder = {
  /**
   * Makes a change to the context folder, after every change asked for before it, and commits
   * what it changed as one change, described by `describe`. Nothing is committed for a change
   * that fails. The change's own result is returned either way, even when git can't keep it.
   */
  change<T, E>(
    make: () => Promise<Result<T, E>>,
    describe: (made: T) => ChangeNote,
  ): Promise<Result<T, E>>;
  /** Like `change`, and says which change it committed: `undefined` when none was. */
  changeWithId<T, E>(
    make: () => Promise<Result<T, E>>,
    describe: (made: T) => ChangeNote,
  ): Promise<Result<{ value: T; id: ChangeId | undefined }, E>>;
  /** Whether the backup has every change, once the changes and pushes asked for so far are done. */
  backup(): Promise<ContextBackup>;
  /**
   * Sets the repository up if it isn't yet, commits the owner's own edits, and pushes whatever the
   * backup is missing. Run at start and every so often.
   */
  keepUp(): Promise<void>;
  /**
   * One page of the changes Recent changes lists for a place (saves, undos, edits and hand edits
   * to its file), newest first, starting after `after` when it's given. The owner's own edits are
   * committed first, so they're listed too.
   */
  history(query: {
    place: Place;
    after?: ChangeId;
    limit: number;
  }): Promise<Result<{ changes: HistoryChange[]; more: ChangeId | null }, HistoryError>>;
  /** One change, or `undefined` when there's no such change. */
  changeOf(id: ChangeId): Promise<Result<HistoryChange | undefined, HistoryError>>;
  /**
   * Files, by their paths from the folder's top, as changes left them (or as they were just before,
   * with `before`), in one go: `null` for one that wasn't there.
   */
  filesAt(
    wanted: readonly { change: ChangeId; before?: boolean; path: string }[],
  ): Promise<Result<(string | null)[], HistoryError>>;
};

/** Why the history can't be read: a change it doesn't have, or git failing. */
export type HistoryError = "unknown-change" | "storage";

/** A change from the history, as its commit describes it. */
export type HistoryChange = {
  readonly id: ChangeId;
  readonly kind: ChangeKind;
  readonly title: string;
  readonly at: string;
  readonly places: readonly Place[];
  readonly session: SessionId | undefined;
};

/** A place's file, by its path from the folder's top. */
export const placeFile = (place: Place) =>
  place.kind === "owner-context" ? OWNER_FILE : `${place.id}/${CONTEXT_FILE}`;

/** Commit fields, and commits, as `git log` prints them here. */
const FIELD = "\x1f";
const RECORD = "\x1e";
const LOG_FORMAT = `--format=%H${FIELD}%cI${FIELD}%s${FIELD}%(trailers:only,unfold)${RECORD}`;

const CommitTime = z.iso.datetime({ offset: true });

/** The place a `Courtyard-Place` trailer names, or `undefined` for one this worker doesn't know. */
const placeFromTrailer = (value: string): Place | undefined => {
  if (value === "owner-context") return { kind: "owner-context" };
  const id = WorkspaceId.safeParse(value.replace(/^workspace\//, ""));
  return value.startsWith("workspace/") && id.success
    ? { kind: "workspace", id: id.data }
    : undefined;
};

/** A file's header in `git cat-file --batch` output: its id, type and size, or that it's missing. */
const BatchHeader = z.union([
  z.tuple([z.string(), z.literal("blob"), z.coerce.number().int().nonnegative()]),
  z.tuple([z.string(), z.literal("missing")]),
]);

/**
 * The files `git cat-file --batch` printed, in the order asked: each is a header line then, for a
 * file that's there, that many bytes and a newline. `undefined` for output it can't read.
 */
const readBatch = (output: Buffer, count: number): (string | null)[] | undefined => {
  const files: (string | null)[] = [];
  let at = 0;
  for (let index = 0; index < count; index += 1) {
    const end = output.indexOf(0x0a, at);
    if (end === -1) return undefined;
    const header = BatchHeader.safeParse(output.toString("utf8", at, end).split(" "));
    if (!header.success) return undefined;
    at = end + 1;
    if (header.data[1] === "missing") {
      files.push(null);
      continue;
    }
    const size = header.data[2];
    files.push(output.toString("utf8", at, at + size));
    at += size + 1;
  }
  return files;
};

/** The changes `git log` printed with `LOG_FORMAT`, skipping any that aren't Courtyard's. */
const parseLog = (log: string): HistoryChange[] =>
  log.split(RECORD).flatMap((record): HistoryChange[] => {
    const [hash = "", at = "", title = "", trailers = ""] = record.trim().split(FIELD);
    const id = ChangeId.safeParse(hash);
    const time = CommitTime.safeParse(at);
    if (!id.success || !time.success) return [];
    const values = (key: string) =>
      trailers
        .split("\n")
        .flatMap((line) =>
          line.startsWith(`${key}: `) ? [line.slice(key.length + 2).trim()] : [],
        );
    const kind = ChangeKind.safeParse(values("Courtyard-Change")[0]);
    if (!kind.success) return [];
    const session = SessionId.safeParse(values("Courtyard-Session")[0]);
    return [
      {
        id: id.data,
        kind: kind.data,
        title,
        at: time.data,
        places: values("Courtyard-Place").flatMap((value) => placeFromTrailer(value) ?? []),
        session: session.success ? session.data : undefined,
      },
    ];
  });

/** The context folder as a git repository the worker looks after (ADRs 0009, 0014). */
export const createContextFolder = (options: {
  contextDir: string;
  /** The backup's git remote, or `null` for none. */
  remote: string | null;
}): ContextFolder => {
  const { contextDir, remote } = options;
  const run = (...args: string[]) => git(contextDir, args, { config: AS_COURTYARD });

  /** The last change in line: each waits for the one before, so two never touch the folder at once. */
  let changes: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(job: () => Promise<T>) => {
    const done = changes.then(job, job);
    changes = done.catch(() => undefined);
    return done;
  };
  /** Pushes and backup status checks wait for each other, but never hold up a change. */
  let pushes: Promise<void> = Promise.resolve();

  /** Why git last couldn't keep a change, until it next can. */
  let gitFailure: string | undefined;
  /** Why the last push failed, until one succeeds. */
  let pushFailure: string | undefined;

  /** Runs git work, noting why it failed rather than failing whatever asked for it. */
  const tryToKeep = async (job: () => Promise<void>) => {
    try {
      await job();
      gitFailure = undefined;
      return true;
    } catch (error) {
      gitFailure = gitFailureReason(error);
      return false;
    }
  };

  /** Commits everything changed in the folder as one change, if anything has. */
  const commitAs = async (note: ChangeNote, options: { evenIfNothing?: boolean } = {}) => {
    await run("add", "--all");
    const staged = await run("diff", "--cached", "--name-only", "--no-renames", "-z");
    const paths = staged.split("\0").filter((path) => path !== "");
    if (paths.length === 0 && !options.evenIfNothing) return undefined;
    const described = note.kind === "hand-edit" ? { ...note, places: placesOf(paths) } : note;
    await run("commit", "--quiet", "--allow-empty", ...commitMessageArgs(described));
    const head = ChangeId.safeParse(await run("rev-parse", "HEAD"));
    return head.success ? head.data : undefined;
  };

  /** Makes the folder a repository with a first change, unless it's one already. */
  const setUp = async () => {
    const repository = await exists(join(contextDir, ".git"));
    if (!repository.ok || !repository.value) await run("init", "--quiet", "--initial-branch=main");
    const started = await run("rev-parse", "--verify", "--quiet", "HEAD").catch(() => "");
    if (started !== "") return;
    await commitAs(
      { kind: "setup", title: "Start keeping the context folder in git", places: [] },
      { evenIfNothing: true },
    );
  };

  /** Ready for a change: set up, with the owner's own edits committed as theirs. */
  const prepare = async () => {
    await setUp();
    await commitAs({ kind: "hand-edit", title: "Edited by hand", places: [] });
  };

  const branch = () => run("symbolic-ref", "--short", "HEAD");

  /**
   * Points the backup remote at the setting. When the setting has moved, the remote is made
   * afresh, so what the old backup had isn't taken for what the new one has.
   */
  const pointAtRemote = async (url: string) => {
    const current = await run("remote", "get-url", REMOTE).catch(() => undefined);
    if (current === url) return;
    if (current !== undefined) await run("remote", "remove", REMOTE);
    await run("remote", "add", REMOTE, url);
  };

  /** The commits the backup doesn't have yet, oldest first. */
  const unpushed = async () => {
    const tracking = `refs/remotes/${REMOTE}/${await branch()}`;
    const pushedBefore = await run("rev-parse", "--verify", "--quiet", tracking).catch(() => "");
    const range = pushedBefore === "" ? ["HEAD"] : [`${tracking}..HEAD`];
    const commits = await run("rev-list", "--reverse", ...range);
    return commits.split("\n").filter((commit) => commit !== "");
  };

  const push = async (url: string) => {
    try {
      await pointAtRemote(url);
      const pushing = ["push", "--quiet", REMOTE, await branch()];
      await git(contextDir, pushing, { timeoutMs: PUSH_GIVES_UP_MS });
      pushFailure = undefined;
    } catch (error) {
      pushFailure = gitFailureReason(error);
    }
  };

  /** Pushes after any push already going, without holding up changes. */
  const pushSoon = () => {
    if (remote === null) return pushes;
    pushes = pushes.then(() => push(remote));
    return pushes;
  };

  const backupNow = async (): Promise<ContextBackup> => {
    if (remote === null) return { kind: "not-set-up" };
    await pointAtRemote(remote);
    const [oldest] = await unpushed();
    if (oldest === undefined) return { kind: "up-to-date" };
    return {
      kind: "behind",
      since: await run("log", "-1", "--format=%cI", oldest),
      reason: pushFailure ?? "It hasn't been backed up yet.",
    };
  };

  /** Whether the repository has this change. */
  const hasChange = (id: ChangeId) =>
    run("cat-file", "-e", `${id}^{commit}`).then(
      () => true,
      () => false,
    );

  /** Git reads for Recent changes: failures are values, and none takes a turn among the changes. */
  const readHistory = async <T>(read: () => Promise<T>): Promise<Result<T, HistoryError>> => {
    try {
      return ok(await read());
    } catch {
      return err("storage");
    }
  };

  const changeWithId: ContextFolder["changeWithId"] = (make, describe) =>
    inTurn(async () => {
      const ready = await tryToKeep(prepare);
      const made = await make();
      if (!made.ok) return made;
      let id: ChangeId | undefined;
      const kept =
        ready &&
        (await tryToKeep(async () => {
          id = await commitAs(describe(made.value));
        }));
      if (kept) void pushSoon();
      return ok({ value: made.value, id });
    });

  return {
    changeWithId,
    change: async (make, describe) => {
      const made = await changeWithId(make, describe);
      return made.ok ? ok(made.value.value) : made;
    },
    backup: async () => {
      await inTurn(async () => undefined);
      // Its git commands wait for pushes (both point the remote at the setting) but never take a
      // turn among the changes, so asking often, as the home page does, can't hold up a save.
      const status = pushes.then(async (): Promise<ContextBackup> => {
        if (gitFailure !== undefined) return { kind: "not-kept", reason: gitFailure };
        try {
          return await backupNow();
        } catch (error) {
          return { kind: "not-kept", reason: gitFailureReason(error) };
        }
      });
      pushes = status.then(() => undefined);
      return status;
    },
    keepUp: async () => {
      const behind = await inTurn(async () => {
        let missing = false;
        await tryToKeep(async () => {
          await prepare();
          missing = remote !== null && (await unpushed()).length > 0;
        });
        return missing;
      });
      if (behind) await pushSoon();
    },
    history: async ({ place, after, limit }) => {
      await inTurn(() => tryToKeep(prepare));
      if (after !== undefined && !(await hasChange(after))) return err("unknown-change");
      return readHistory(async () => {
        const log = await run(
          "log",
          `-n${limit + 1}`,
          "--all-match",
          "--extended-regexp",
          `--grep=^${placeTrailer(place)}$`,
          `--grep=^Courtyard-Change: (${RecentChangeKind.options.join("|")})$`,
          LOG_FORMAT,
          // After a change: that change and older, skipping the change itself, which matches.
          ...(after === undefined ? ["HEAD"] : [after, "--skip=1"]),
          "--",
          placeFile(place),
        );
        const changes = parseLog(log);
        const page = changes.slice(0, limit);
        return { changes: page, more: changes.length > limit ? (page.at(-1)?.id ?? null) : null };
      });
    },
    changeOf: async (id) => {
      if (!(await hasChange(id))) return ok(undefined);
      return readHistory(async () => parseLog(await run("log", "-1", LOG_FORMAT, id, "--"))[0]);
    },
    filesAt: async (wanted) => {
      const names = wanted.map(
        ({ change, before, path }) => `${change}${before ? "^" : ""}:${path}`,
      );
      const read = await readHistory(() =>
        gitBytes(contextDir, { args: ["cat-file", "--batch"], input: `${names.join("\n")}\n` }),
      );
      if (!read.ok) return read;
      const files = readBatch(read.value, wanted.length);
      return files === undefined ? err("storage") : ok(files);
    },
  };
};
