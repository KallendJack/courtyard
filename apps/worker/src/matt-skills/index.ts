import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillName } from "@courtyard/contract";
import { type MattPin, readMattPin } from "@courtyard/skills";
import { z } from "zod";
import { exists, listSubfolders, move, removeFolder } from "../files.ts";
import { git, gitFailureReason } from "../git.ts";
import { err, ok, type Result } from "../result.ts";

/**
 * Matt Pocock's skills for code workspaces (ADR 0023): Courtyard's pinned copy of his plugin,
 * fetched from his own plugin list at the version `matt.json` names, kept in the data folder, and
 * loaded only when it matches `matt.json`'s checksum. Never the worker machine's installed plugin.
 */

export type { MattPin };

/**
 * Puts the files of `source` (a git repository) at its release `version` into the empty folder
 * `into`, or says why it couldn't. A dependency, so tests never reach the network.
 */
export type FetchMattSkills = (fetch: {
  readonly source: string;
  readonly version: string;
  readonly into: string;
}) => Promise<Result<null, string>>;

/** How long fetching may take before it counts as failed. */
const FETCH_TIMEOUT_MS = 120_000;

/**
 * The real fetch: the release's tag (`v1.3.1`) from his repository, one commit deep, checked out
 * byte for byte (no line endings changed), so the checksum is the same on every machine.
 */
export const fetchFromGitHub: FetchMattSkills = async ({ source, version, into }) => {
  try {
    await git(into, ["init", "--quiet"]);
    await git(into, ["fetch", "--quiet", "--depth", "1", source, `refs/tags/v${version}`], {
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    await git(into, ["checkout", "--quiet", "FETCH_HEAD"], {
      config: ["core.autocrlf=false", "core.eol=lf", "core.symlinks=false"],
    });
    return ok(null);
  } catch (error) {
    return err(gitFailureReason(error));
  }
};

/** Where his plugin says what it is, in a plugin's folder. */
const MANIFEST = join(".claude-plugin", "plugin.json");
const LICENSE = "LICENSE";

/**
 * His `plugin.json`, as far as Courtyard keeps it: its name, version and skills. Anything that
 * would run outside the worker's say on a tool call (hooks, MCP servers, commands, agents) is
 * refused, since none of it is kept.
 */
const PluginManifest = z
  .looseObject({
    name: z.string().regex(/^[a-z0-9-]+$/),
    version: z.string(),
    skills: z.array(z.string().regex(/^\.\/skills\/[a-z0-9-]+\/[a-z0-9-]+$/)).min(1),
  })
  .refine(
    (manifest) =>
      !["hooks", "mcpServers", "commands", "agents", "lspServers", "outputStyles"].some(
        (part) => part in manifest,
      ),
  );

/** One of his skills in a kept copy: its name (its folder's) and its folder. */
export type MattSkill = { readonly name: string; readonly folder: string };

/** A kept copy of his plugin, ready for Claude Code to load as a local plugin. */
export type MattCopy = {
  readonly folder: string;
  /** The plugin's name, which Claude Code puts before each of its skills' (`mattpocock-skills:tdd`). */
  readonly plugin: string;
  readonly version: string;
  readonly skills: readonly MattSkill[];
  /** The ones the Skill picker lists, since the owner starts them (`picker` in `matt.json`). */
  readonly picker: readonly SkillName[];
};

/** The plugin's manifest in `folder`, or why it can't be kept. */
const manifestIn = async (folder: string) => {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(join(folder, MANIFEST), "utf8"));
  } catch {
    return err("its plugin.json can't be read");
  }
  const parsed = PluginManifest.safeParse(json);
  return parsed.success ? ok(parsed.data) : err("its plugin.json isn't one Courtyard keeps");
};

/** Every file under `folder`, by its path from there with `/`, or why not: a link is refused. */
const filesUnder = async (folder: string, from = ""): Promise<Result<string[], string>> => {
  const entries = await readdir(join(folder, from), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = from === "" ? entry.name : `${from}/${entry.name}`;
    if (entry.isSymbolicLink()) return err(`${path} is a link`);
    if (entry.isDirectory()) {
      const inside = await filesUnder(folder, path);
      if (!inside.ok) return inside;
      files.push(...inside.value);
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return ok(files);
};

/**
 * The checksum of a kept copy: SHA-256 over each file's path and its own SHA-256, in path order,
 * so the same files give the same checksum on every machine. What `matt.json` records.
 */
export const mattChecksum = async (folder: string): Promise<Result<string, string>> => {
  try {
    const files = await filesUnder(folder);
    if (!files.ok) return files;
    const whole = createHash("sha256");
    for (const path of files.value.sort()) {
      const bytes = await readFile(join(folder, path));
      whole.update(`${path}\0${createHash("sha256").update(bytes).digest("hex")}\n`);
    }
    return ok(`sha256-${whole.digest("hex")}`);
  } catch {
    return err("its files can't be read");
  }
};

/**
 * Fetches his plugin at `version` and keeps what Courtyard uses of it in the empty folder `into`:
 * its `plugin.json`, his licence, and the skills `plugin.json` lists, nothing else. Its checksum,
 * or why it couldn't. Used on start, and by the weekly check for his next release.
 */
export const fetchMattCopy = async (options: {
  readonly source: string;
  readonly version: string;
  readonly fetch: FetchMattSkills;
  readonly into: string;
}): Promise<Result<string, string>> => {
  const download = `${options.into}.download`;
  try {
    await mkdir(download, { recursive: true });
    const fetched = await options.fetch({
      source: options.source,
      version: options.version,
      into: download,
    });
    if (!fetched.ok) return err(`they couldn't be fetched: ${fetched.error}`);
    const manifest = await manifestIn(download);
    if (!manifest.ok) return manifest;
    if (manifest.value.version !== options.version) {
      return err(`the release fetched says it's ${manifest.value.version}`);
    }
    for (const kept of [MANIFEST, LICENSE, ...manifest.value.skills]) {
      await cp(join(download, kept), join(options.into, kept), {
        recursive: true,
        verbatimSymlinks: true,
      });
    }
    return await mattChecksum(options.into);
  } catch {
    return err("the release fetched isn't laid out as his plugin is");
  } finally {
    await removeFolder(download);
  }
};

/** The skills a kept copy holds, read from its `plugin.json`. */
const copyIn = async (folder: string, pin: MattPin): Promise<Result<MattCopy, string>> => {
  const manifest = await manifestIn(folder);
  if (!manifest.ok) return manifest;
  return ok({
    folder,
    plugin: manifest.value.name,
    version: manifest.value.version,
    picker: pin.picker,
    skills: manifest.value.skills.map((path) => {
      const name = path.split("/").at(-1) ?? "";
      return { name, folder: join(folder, ...path.slice(2).split("/")) };
    }),
  });
};

/** Where the kept copies are, in the data folder: one folder per version. */
const FOLDER = "matt-skills";

/**
 * Keeps the copy `pin` names in the data folder: the one already there when it still matches the
 * checksum, otherwise a fresh fetch, kept only when it matches. Copies of other versions go.
 */
const keepCopy = async (options: {
  readonly dataDir: string;
  readonly pin: MattPin;
  readonly fetch: FetchMattSkills;
}): Promise<Result<MattCopy, string>> => {
  const { pin } = options;
  const top = join(options.dataDir, FOLDER);
  const folder = join(top, pin.version);
  const there = await exists(folder);
  if (there.ok && there.value) {
    const kept = await mattChecksum(folder);
    if (kept.ok && kept.value === pin.checksum) return copyIn(folder, pin);
    await removeFolder(folder);
  }
  const staging = join(top, `.fetching-${randomUUID()}`);
  try {
    const checksum = await fetchMattCopy({
      source: pin.source,
      version: pin.version,
      fetch: options.fetch,
      into: staging,
    });
    if (!checksum.ok) return checksum;
    if (checksum.value !== pin.checksum) {
      return err(`the copy fetched doesn't match the checksum in matt.json, so it isn't loaded`);
    }
    await move(staging, folder);
  } catch {
    return err("the copy couldn't be kept in the data folder");
  } finally {
    await removeFolder(staging);
  }
  const versions = await listSubfolders(top);
  for (const other of versions.ok ? versions.value : []) {
    if (other !== pin.version) await removeFolder(join(top, other));
  }
  return copyIn(folder, pin);
};

/** How long after a failed fetch the next use tries again, so a network blip doesn't stay. */
const RETRY_AFTER_MS = 5 * 60 * 1000;

/**
 * Matt's skills as the worker uses them: `copy()` gives the kept copy, or why there's none in the
 * owner's words ("the copy fetched doesn't match the checksumâ€¦"). Started once, with the worker;
 * a failure is tried again after a while. `pin` is `matt.json` as read.
 */
export const createMattSkills = (options: {
  readonly dataDir: string;
  readonly pin?: MattPin;
  readonly fetch: FetchMattSkills;
  readonly now: () => number;
}) => {
  const load = async (): Promise<Result<MattCopy, string>> => {
    const pin = options.pin === undefined ? await readMattPin() : ok(options.pin);
    if (!pin.ok) return pin;
    const kept = await keepCopy({ dataDir: options.dataDir, pin: pin.value, fetch: options.fetch });
    if (!kept.ok) console.error(`Matt Pocock's skills aren't loaded: ${kept.error}.`);
    return kept;
  };
  let loading = { at: options.now(), copy: load() };
  return {
    copy: async (): Promise<Result<MattCopy, string>> => {
      const copy = await loading.copy;
      if (!copy.ok && options.now() - loading.at >= RETRY_AFTER_MS) {
        loading = { at: options.now(), copy: load() };
        return loading.copy;
      }
      return copy;
    },
  };
};

export type MattSkills = ReturnType<typeof createMattSkills>;
