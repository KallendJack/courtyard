import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, OwnerContextDetail, WorkspaceDetail } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asOwner, postJson, type Requester } from "./testing.ts";
import { createWorker } from "./worker.ts";

let root: string;
let contextDir: string;
let request: Requester;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  contextDir = join(root, "context");
  await mkdir(contextDir);
  const worker = createWorker({
    env: { COURTYARD_CONTEXT_DIR: contextDir, COURTYARD_DATA_DIR: join(root, "data") },
  });
  if (!worker.ok) throw new Error(worker.error);
  request = await asOwner(worker.value.app);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const OWNER_FILE = () => join(contextDir, "OWNER.md");

const readOwnerContext = async () => {
  const response = await request("/api/owner-context");
  expect(response.status).toBe(200);
  return OwnerContextDetail.parse(await response.json()).ownerContext;
};

const startOwnerContext = () => postJson(request, "/api/owner-context", {});

describe("reading the owner context", () => {
  it("is absent until there's an OWNER.md", async () => {
    expect(await readOwnerContext()).toBeNull();
  });

  it("reads About me's facts, plans and ideas, and how the owner likes answers", async () => {
    await writeFile(
      OWNER_FILE(),
      [
        "# Owner context",
        "",
        "Shared with every workspace.",
        "",
        "## About me",
        "",
        "### Facts",
        "- Lives in the UK.",
        "- Has a dog.",
        "",
        "### Plans",
        "- Moving house in spring.",
        "",
        "### Ideas",
        "- An allotment.",
        "",
        "## How to answer me",
        "",
        "- Metric units and pounds.",
        "- Short answers first,",
        "  detail after.",
        "",
      ].join("\n"),
    );

    expect(await readOwnerContext()).toEqual({
      intro: "Shared with every workspace.",
      facts: ["Lives in the UK.", "Has a dog."],
      plans: ["Moving house in spring."],
      ideas: ["An allotment."],
      answers: ["Metric units and pounds.", "Short answers first, detail after."],
      characters: expect.any(Number),
    });
  });

  it("says how long it is, since it goes with every message in every workspace", async () => {
    await writeFile(OWNER_FILE(), "## How to answer me\n- Briefly.\n");

    expect((await readOwnerContext())?.characters).toBe(31);
  });
});

describe("starting the owner context", () => {
  it("writes a starter OWNER.md with both sections empty", async () => {
    const response = await startOwnerContext();

    expect(response.status).toBe(201);
    const { ownerContext } = OwnerContextDetail.parse(await response.json());
    expect(ownerContext).toMatchObject({ facts: [], plans: [], ideas: [], answers: [] });
    expect(ownerContext?.intro).toContain("every workspace");
    const markdown = await readFile(OWNER_FILE(), "utf8");
    expect(markdown).toMatch(/^# Owner context\n/);
    expect(markdown).toContain("## About me");
    expect(markdown).toContain("## How to answer me");
  });

  it("never replaces an owner context that's already there", async () => {
    await writeFile(OWNER_FILE(), "## How to answer me\n- Briefly.\n");

    const response = await startOwnerContext();

    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).error).toMatch(/already/i);
    expect(await readFile(OWNER_FILE(), "utf8")).toBe("## How to answer me\n- Briefly.\n");
  });
});

describe("what a workspace's models read of it", () => {
  const sharedWith = async (id: string) => {
    const response = await request(`/api/workspaces/${id}`);
    expect(response.status).toBe(200);
    return WorkspaceDetail.parse(await response.json()).ownerContextShared;
  };

  beforeEach(async () => {
    await mkdir(join(contextDir, "garage-gym"));
    await mkdir(join(contextDir, "side-project"));
    await writeFile(
      join(contextDir, "side-project", "workspace.json"),
      '{ "mode": "code", "repoPath": "/path/to/repo" }',
    );
  });

  it("is all of it in a planning workspace, and how to answer in a code workspace", async () => {
    await writeFile(
      OWNER_FILE(),
      "## About me\n### Facts\n- UK.\n## How to answer me\n- Briefly.\n",
    );

    expect(await sharedWith("garage-gym")).toBe("all");
    expect(await sharedWith("side-project")).toBe("answers");
  });

  it("is nothing without an owner context, or for a code workspace when it has no answers", async () => {
    expect(await sharedWith("garage-gym")).toBe("none");

    await writeFile(OWNER_FILE(), "## About me\n### Facts\n- UK.\n");

    expect(await sharedWith("garage-gym")).toBe("all");
    expect(await sharedWith("side-project")).toBe("none");
  });

  it("is nothing while it has no lines, such as the untouched starter", async () => {
    expect((await startOwnerContext()).status).toBe(201);

    expect(await sharedWith("garage-gym")).toBe("none");
    expect(await sharedWith("side-project")).toBe("none");
  });

  it("finds How to answer me under a heading at any level", async () => {
    await writeFile(
      OWNER_FILE(),
      ["# Me", "### About me", "#### Facts", "- UK.", "### How to answer me", "- Briefly."].join(
        "\n",
      ),
    );

    expect(await readOwnerContext()).toMatchObject({ facts: ["UK."], answers: ["Briefly."] });
    expect(await sharedWith("side-project")).toBe("answers");
  });
});
