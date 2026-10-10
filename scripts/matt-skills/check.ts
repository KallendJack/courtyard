// The weekly check for Matt Pocock's next release (#181, ADR 0023; .github/workflows/matt-skills.yml).
// Compares packages/skills/matt.json with the newest release on his plugin list and, when the pin is
// behind, writes the issue that asks for the bump to the file named by its one argument: his
// CHANGELOG lines since the pinned version, and matt.json as it should be, its checksum worked out
// the way the worker checks it. Prints `version=<newest>` then, for GitHub Actions; nothing when
// the pin is current.
//
//   node scripts/matt-skills/check.ts <issue body file>

import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchFromGitHub, fetchMattCopy } from "../../apps/worker/src/matt-skills/index.ts";
import { readMattPin } from "../../packages/skills/index.ts";

const bodyFile = process.argv[2];
if (bodyFile === undefined) throw new Error("Name the file to write the issue's body to.");

const pin = await readMattPin();
if (!pin.ok) throw new Error(pin.error);
const { source, version: pinned } = pin.value;

/** A version's numbers, to compare. */
const numbers = (version: string) => version.split(".").map(Number);
const newer = (a: string, b: string) => {
  const [x, y] = [numbers(a), numbers(b)];
  for (let at = 0; at < 3; at += 1) {
    if ((x[at] ?? 0) !== (y[at] ?? 0)) return (x[at] ?? 0) > (y[at] ?? 0);
  }
  return false;
};

const tags = execFileSync("git", ["ls-remote", "--tags", source], { encoding: "utf8" });
const releases = [...tags.matchAll(/refs\/tags\/v(\d+\.\d+\.\d+)$/gm)].flatMap((match) =>
  match[1] === undefined ? [] : [match[1]],
);
const newest = releases.reduce((best, each) => (newer(each, best) ? each : best), pinned);
if (newest === pinned) process.exit(0);

const work = await mkdtemp(join(tmpdir(), "courtyard-matt-check-"));
try {
  const download = join(work, "download");
  await mkdir(download, { recursive: true });
  const fetched = await fetchFromGitHub({ source, version: newest, into: download });
  if (!fetched.ok) throw new Error(fetched.error);
  const kept = await fetchMattCopy({
    source,
    version: newest,
    into: join(work, "copy"),
    // Already fetched: copied, so GitHub is asked once.
    fetch: async ({ into }) => {
      await cp(download, into, { recursive: true });
      return { ok: true, value: null };
    },
  });
  if (!kept.ok) throw new Error(kept.error);

  // His CHANGELOG has a `## <version>` section per release, newest first.
  const changelog = await readFile(join(download, "CHANGELOG.md"), "utf8").catch(() => "");
  const sections = changelog.split(/^(?=## )/m).filter((section) => {
    const version = /^## v?(\d+\.\d+\.\d+)/.exec(section)?.[1];
    return version !== undefined && newer(version, pinned);
  });
  const nextPin = { ...pin.value, version: newest, checksum: kept.value };

  await writeFile(
    bodyFile,
    [
      `Matt Pocock's skills ${newest} is out; Courtyard pins ${pinned} (\`packages/skills/matt.json\`, ADR 0023).`,
      "",
      "Bump the pin to this, then check the Skill picker's list still names his owner-started skills:",
      "",
      "```json",
      JSON.stringify(nextPin, null, 2),
      "```",
      "",
      "## What changed (his CHANGELOG)",
      "",
      sections.length === 0
        ? "His CHANGELOG has nothing for these releases."
        : sections.join("\n").trim(),
      "",
      "Opened by the weekly check (`.github/workflows/matt-skills.yml`).",
    ].join("\n"),
  );
  console.log(`version=${newest}`);
} finally {
  await rm(work, { recursive: true, force: true });
}
