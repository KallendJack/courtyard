import { BuildFile, BuildSlug } from "@courtyard/contract";
import type { WholeFile } from "../context-folder/index.ts";
import { pathInWorkspace } from "../planning-files/index.ts";

// A change to a Build as Recent changes lists it (`changes/`), from the whole files it wrote.

/** The Build a path in the workspace's folder names (`builds/<slug>.json`), if it names one. */
const slugOfPath = (path: string): BuildSlug | undefined => {
  const [, name] = /^builds\/([^/]+)\.json$/.exec(path) ?? [];
  const slug = BuildSlug.safeParse(name);
  return slug.success ? slug.data : undefined;
};

/** Whether a change's files are a Build's. */
export const isBuildChange = (files: readonly Pick<WholeFile, "path">[]) =>
  files.some(({ path }) => slugOfPath(pathInWorkspace(path)) !== undefined);

/** What a change did to a Build, from the whole files it wrote or removed, for Recent changes. */
export const buildChangeOf = (files: readonly WholeFile[]) => {
  const file = files.find((one) => slugOfPath(pathInWorkspace(one.path)));
  const slug = file && (slugOfPath(pathInWorkspace(file.path)) ?? null);
  const nameIn = (text: string | null) => {
    if (text === null) return undefined;
    try {
      return BuildFile.safeParse(JSON.parse(text)).data?.name;
    } catch {
      return undefined;
    }
  };
  const name = nameIn(file?.after ?? null) ?? nameIn(file?.before ?? null) ?? slug ?? "a Build";
  const did = file?.before === null ? "added" : file?.after === null ? "removed" : "changed";
  return {
    build: { did, name, slug: did === "removed" ? null : (slug ?? null) },
    path: did === "removed" || file === undefined ? null : file.path,
  } as const;
};
