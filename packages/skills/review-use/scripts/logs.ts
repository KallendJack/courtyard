import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Review use's reading (#606): the sessions with events in the window, from the data folder's
 * `sessions/<session>/session.json` and `events.jsonl`, and each workspace's name and kind from the
 * context folder's `<workspace>/workspace.json`. Nothing else is read, and nothing is written.
 */

export type ReviewOptions = {
  /** The data folder (`COURTYARD_DATA_DIR`). */
  readonly data: string;
  /** The context folder (`COURTYARD_CONTEXT_DIR`), for the workspaces' names; by id without it. */
  readonly context?: string | undefined;
  /** The window's first day and last day, both counted. */
  readonly since: string;
  readonly until: string;
};

export type Event = { readonly seq: number; readonly at: string; readonly type: string } & Record<
  string,
  unknown
>;

export type Session = {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly branch?: string;
  readonly byLead?: boolean;
  readonly claim?: { readonly issue: number };
  /** Its events in the window, in order. */
  readonly events: readonly Event[];
};

export type Workspace = { readonly name: string; readonly mode: "planning" | "code" | undefined };

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The window as times: from the first day's start to the last day's end. */
export const windowOf = ({ since, until }: ReviewOptions) => ({
  from: Date.parse(`${since}T00:00:00.000Z`),
  to: Date.parse(`${until}T00:00:00.000Z`) + DAY_MS,
});

const readJson = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const folders = async (path: string) => {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
};

/** A session's events, each line that reads as one; a line cut off mid-write is skipped. */
const eventsOf = async (path: string): Promise<Event[]> => {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }
  return text.split(/\r?\n/).flatMap((line) => {
    if (line.trim() === "") return [];
    try {
      const event: unknown = JSON.parse(line);
      return isRecord(event) && typeof event.type === "string" && typeof event.at === "string"
        ? [event as Event]
        : [];
    } catch {
      return [];
    }
  });
};

/** Every session with an event in the window, with only those events. */
export const sessionsIn = async (options: ReviewOptions): Promise<Session[]> => {
  const { from, to } = windowOf(options);
  const root = join(options.data, "sessions");
  const found = await Promise.all(
    (await folders(root)).map(async (id): Promise<Session[]> => {
      const file = await readJson(join(root, id, "session.json"));
      if (!isRecord(file) || typeof file.workspaceId !== "string") return [];
      const events = (await eventsOf(join(root, id, "events.jsonl"))).filter((event) => {
        const at = Date.parse(event.at);
        return at >= from && at < to;
      });
      if (events.length === 0) return [];
      const claim = isRecord(file.claim) && typeof file.claim.issue === "number" ? file.claim : {};
      return [
        {
          id,
          workspaceId: file.workspaceId,
          title: typeof file.title === "string" ? file.title : id,
          ...(typeof file.branch === "string" ? { branch: file.branch } : {}),
          ...(file.byLead === true ? { byLead: true } : {}),
          ...("issue" in claim ? { claim: { issue: claim.issue as number } } : {}),
          events,
        },
      ];
    }),
  );
  return found.flat().sort((a, b) => (a.events[0]?.at ?? "").localeCompare(b.events[0]?.at ?? ""));
};

/** Each workspace's name and kind, from its `workspace.json`. */
export const workspaceOf = async (context: string | undefined, id: string): Promise<Workspace> => {
  const file =
    context === undefined ? undefined : await readJson(join(context, id, "workspace.json"));
  if (!isRecord(file)) return { name: id, mode: undefined };
  const mode = file.mode === "planning" || file.mode === "code" ? file.mode : undefined;
  return { name: typeof file.name === "string" ? file.name : id, mode };
};

export const count = (events: readonly Event[], test: (event: Event) => boolean) =>
  events.filter(test).length;

export const table = (head: readonly string[], rows: readonly (readonly (string | number)[])[]) =>
  [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
