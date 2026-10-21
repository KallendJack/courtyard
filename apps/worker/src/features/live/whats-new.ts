import { join } from "node:path";
import type { WhatsNew, WhatsNewPlace, WorkspaceId } from "@courtyard/contract";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../../lib/files.ts";
import { gitOrNothing } from "../../lib/git.ts";
import { err, ok, type Result } from "../../lib/result.ts";

/**
 * What's new after an Update (#604): each pull request merged since the last version that changes
 * what the owner sees says so in one line of its description, `What's new: <what> · <where>`.
 * After an Update, Home says each once, the next one not yet tapped, until the next Update.
 */

/** The line in a pull request's description, bold or not: `What's new: Draw the garage · Garage`. */
const LINE = /^[ \t]*(?:\*\*)?What['’]s new:?(?:\*\*)?:?[ \t]*(.+?)[ \t]*$/im;

/** A merge commit's subject, as GitHub writes it: `Merge pull request #604 from …`. */
const MERGED = /^Merge pull request #(\d+) /;

/** One line as kept: where it's tried is kept as the words the line gave, and read when shown. */
const Kept = z.object({
  pullRequest: z.number().int().positive(),
  what: z.string(),
  where: z.string().nullable(),
});
type Kept = z.infer<typeof Kept>;

/** The last Update's lines, by the commit it updated to, and those tapped. */
const KeptFile = z.object({
  update: z.string(),
  lines: z.array(Kept),
  seen: z.array(z.number().int()),
});
type KeptFile = z.infer<typeof KeptFile>;

/** A line's words, what's new and where to try it: the last `·` parts them. */
export const whatsNewIn = (description: string): Omit<Kept, "pullRequest"> | undefined => {
  const words = LINE.exec(description)?.[1]?.replace(/\.$/, "").trim();
  if (words === undefined || words === "") return undefined;
  const at = words.lastIndexOf(" · ");
  return at === -1
    ? { what: words, where: null }
    : { what: words.slice(0, at).trim(), where: words.slice(at + 3).trim() };
};

export type WhatsNewLines = {
  /**
   * The next line of the Update that `update` says the live copy made, not yet tapped, or `null`.
   * Reads the pull requests it brought once per Update.
   */
  next(update: { from: string; to: string } | null): Promise<WhatsNew | null>;
  /** A line tapped: said, and gone. Refused when the last Update has no such line. */
  seen(pullRequest: number): Promise<Result<null, "not-found">>;
};

export const createWhatsNew = (options: {
  liveCopy: string;
  dataDir: string;
  /** A merged pull request's description, by its number; an error when GitHub can't be asked. */
  descriptionOf: (pullRequest: number) => Promise<Result<string | undefined, "unreachable">>;
  /** Where a line's words say to try it: a workspace by its name, or Settings, or Home. */
  placeNamed: (where: string | null) => Promise<WhatsNewPlace>;
}): WhatsNewLines => {
  const file = join(options.dataDir, "whats-new.json");
  /** Reading an Update's pull requests, shared by pages asking at once. */
  let reading:
    | { readonly update: string; readonly done: Promise<KeptFile | undefined> }
    | undefined;

  const kept = async () => {
    const read = await readJsonFile(file, KeptFile);
    return read.ok ? read.value : undefined;
  };

  /** The lines of the pull requests merged from `from` to `to`, oldest first; none when unsure. */
  const readUpdate = async (from: string, to: string): Promise<KeptFile | undefined> => {
    const log = await gitOrNothing(options.liveCopy, [
      "log",
      "--first-parent",
      "--reverse",
      "--format=%s",
      `${from}..${to}`,
    ]);
    if (log === undefined) return undefined;
    const numbers = log.split("\n").flatMap((subject) => {
      const number = MERGED.exec(subject)?.[1];
      return number === undefined ? [] : [Number(number)];
    });
    const lines: Kept[] = [];
    for (const pullRequest of numbers) {
      const description = await options.descriptionOf(pullRequest);
      // GitHub can't be asked now: read them all again next time.
      if (!description.ok) return undefined;
      const line = description.value === undefined ? undefined : whatsNewIn(description.value);
      if (line !== undefined) lines.push({ pullRequest, ...line });
    }
    const read = { update: to, lines, seen: [] };
    const written = await writeJsonFile(file, read);
    if (!written.ok) console.error("What's new couldn't be kept in the data folder");
    return read;
  };

  const linesOf = async (update: { from: string; to: string }) => {
    const now = await kept();
    if (now?.update === update.to) return now;
    if (reading?.update !== update.to) {
      const done = readUpdate(update.from, update.to);
      reading = { update: update.to, done };
      void done.then(() => {
        if (reading?.done === done) reading = undefined;
      });
    }
    return reading.done;
  };

  return {
    next: async (update) => {
      if (update === null) return null;
      const lines = await linesOf(update);
      const line = lines?.lines.find(({ pullRequest }) => !lines.seen.includes(pullRequest));
      if (line === undefined) return null;
      return {
        pullRequest: line.pullRequest,
        what: line.what,
        place: await options.placeNamed(line.where),
      };
    },
    seen: async (pullRequest) => {
      const now = await kept();
      if (now === undefined || !now.lines.some((line) => line.pullRequest === pullRequest)) {
        return err("not-found");
      }
      if (!now.seen.includes(pullRequest)) {
        const written = await writeJsonFile(file, { ...now, seen: [...now.seen, pullRequest] });
        if (!written.ok) console.error("What's new couldn't be kept in the data folder");
      }
      return ok(null);
    },
  };
};

/** Where a line's words say to try it, among these workspaces: by name, then Settings, else Home. */
export const placeAmong = (
  where: string | null,
  workspaces: readonly { readonly id: WorkspaceId; readonly name: string }[],
): WhatsNewPlace => {
  const words = where?.trim().toLowerCase();
  if (words === undefined || words === "") return { kind: "home" };
  const workspace = workspaces.find(({ name }) => name.toLowerCase() === words);
  if (workspace !== undefined) return { kind: "workspace", id: workspace.id, name: workspace.name };
  return words === "settings" ? { kind: "settings" } : { kind: "home" };
};
