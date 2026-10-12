import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GitHubRepoList, WorkspaceDetail, WorkspaceSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner,
  codeRepo,
  codeWorkspace,
  createFakeGitHub,
  errorOf,
  type FakeGitHub,
  gitIn,
  postJson,
  type Requester,
  removeTestFolder,
  testWorker,
} from "./testing.ts";

// A code workspace made from the app (#258): New workspace → Code lists the owner's GitHub repos
// that Courtyard's GitHub App reaches, and picking one gets it onto the worker machine, in the
// data folder's `repos/`, before the workspace is made on it.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context"));
});

afterEach(async () => {
  await removeTestFolder(root);
});

/** Signs in to the fake GitHub from Connections, as the owner does with a device code. */
const signIn = async (request: Requester, github: FakeGitHub) => {
  await postJson(request, "/api/github/sign-in", {});
  github.approve();
  await expect
    .poll(async () => ((await (await request("/api/github")).json()) as { kind: string }).kind)
    .toBe("signed-in");
};

/**
 * A repository on GitHub, standing in as a bare repository on disk with one commit on `main`:
 * its README.
 */
const remoteRepo = async (name: string) => {
  const remote = join(root, `${name}.git`);
  const pusher = join(root, `${name}-pusher`);
  await mkdir(remote, { recursive: true });
  await gitIn(remote, "init", "--quiet", "--bare", "--initial-branch=main");
  await gitIn(root, "clone", "--quiet", remote, pusher);
  await writeFile(join(pusher, "README.md"), `# ${name}\n`);
  await gitIn(pusher, "add", ".");
  await gitIn(pusher, "commit", "--quiet", "-m", "Start");
  await gitIn(pusher, "push", "--quiet", "origin", "main");
  return remote;
};

const reposOf = async (request: Requester) => {
  const response = await request("/api/github/repos");
  expect(response.status).toBe(200);
  return GitHubRepoList.parse(await response.json()).repos;
};

describe("the owner's repos", () => {
  it("lists the repos Courtyard's GitHub App reaches, each with its description, and marks the ones already a code workspace's", async () => {
    // Side project is a code workspace already, on a checkout of octo-owner/side-project.
    const { repo } = await codeRepo(root);
    await codeWorkspace(root, "side-project", repo);
    const github = createFakeGitHub({
      repos: [
        {
          fullName: "octo-owner/garrett-kitchens",
          description: "Website for a kitchen fitter",
          private: true,
        },
        { fullName: "octo-owner/side-project", private: false },
        { fullName: "octo-owner/stacks", private: true },
      ],
    });
    const request = await asOwner(testWorker({ root, github: github.api }));
    await signIn(request, github);

    expect(await reposOf(request)).toEqual([
      {
        repo: "octo-owner/garrett-kitchens",
        name: "garrett-kitchens",
        description: "Website for a kitchen fitter",
        private: true,
        added: false,
      },
      {
        repo: "octo-owner/stacks",
        name: "stacks",
        description: null,
        private: true,
        added: false,
      },
      // The ones already added come last.
      {
        repo: "octo-owner/side-project",
        name: "side-project",
        description: null,
        private: false,
        added: true,
      },
    ]);
  });

  it("says to sign in to GitHub first, while no one is signed in", async () => {
    const github = createFakeGitHub();
    const request = await asOwner(testWorker({ root, github: github.api }));

    const response = await request("/api/github/repos");

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatch(/Sign in to GitHub from Connections/);
  });
});

describe("a code workspace made from a picked repo", () => {
  it("gets the repo onto the worker machine in the data folder, makes the workspace on it, and the repo shows as added", async () => {
    const remote = await remoteRepo("garrett-kitchens");
    const github = createFakeGitHub({
      repos: [{ fullName: "octo-owner/garrett-kitchens", private: true, cloneUrl: remote }],
    });
    const request = await asOwner(testWorker({ root, github: github.api }));
    await signIn(request, github);

    const response = await postJson(request, "/api/workspaces", {
      name: "Garrett Kitchens",
      intro: "Website for a kitchen fitter",
      repo: "octo-owner/garrett-kitchens",
    });

    expect(response.status).toBe(201);
    const made = WorkspaceSummary.parse(await response.json());
    expect(made).toMatchObject({ id: "garrett-kitchens", mode: "code", icon: "code" });
    const clone = resolve(root, "data", "repos", "octo-owner", "garrett-kitchens");
    expect(await gitIn(clone, "log", "-1", "--format=%s")).toBe("Start");
    expect(await readFile(join(clone, "README.md"), "utf8")).toMatch(/^# garrett-kitchens\r?\n$/);
    const config: unknown = JSON.parse(
      await readFile(join(root, "context", "garrett-kitchens", "workspace.json"), "utf8"),
    );
    // Its name and one line live in its workspace.json: a code workspace has no context file (#301).
    expect(config).toMatchObject({
      name: "Garrett Kitchens",
      mode: "code",
      repoPath: clone,
      description: "Website for a kitchen fitter",
    });
    expect(existsSync(join(root, "context", "garrett-kitchens", "CONTEXT.md"))).toBe(false);
    // No token is kept in the clone's git settings: git asks Courtyard's sign-in each time.
    const gitConfig = await readFile(join(clone, ".git", "config"), "utf8");
    expect(gitConfig).not.toContain(github.token() ?? "no token");
    expect(gitConfig).not.toContain("ghu_");

    const detail = WorkspaceDetail.parse(
      await (await request("/api/workspaces/garrett-kitchens")).json(),
    );
    expect(detail).toMatchObject({
      workspace: { name: "Garrett Kitchens" },
      contextFile: null,
      description: "Website for a kitchen fitter",
    });
    expect(await reposOf(request)).toEqual([expect.objectContaining({ added: true })]);
  });

  it("uses the copy already in the data folder rather than getting it again", async () => {
    const remote = await remoteRepo("stacks");
    const github = createFakeGitHub({
      repos: [{ fullName: "octo-owner/stacks", private: true, cloneUrl: remote }],
    });
    const request = await asOwner(testWorker({ root, github: github.api }));
    await signIn(request, github);
    const clone = join(root, "data", "repos", "octo-owner", "stacks");
    await mkdir(join(root, "data", "repos", "octo-owner"), { recursive: true });
    await gitIn(root, "clone", "--quiet", remote, clone);
    await writeFile(join(clone, "notes.txt"), "Left here\n");

    const response = await postJson(request, "/api/workspaces", {
      name: "Stacks",
      repo: "octo-owner/stacks",
    });

    expect(response.status).toBe(201);
    expect(await readFile(join(clone, "notes.txt"), "utf8")).toBe("Left here\n");
  });

  it("refuses a repo that's a code workspace's already, and one the GitHub App doesn't reach", async () => {
    const { repo } = await codeRepo(root);
    await codeWorkspace(root, "side-project", repo);
    const github = createFakeGitHub({ repos: [{ fullName: "octo-owner/side-project" }] });
    const request = await asOwner(testWorker({ root, github: github.api }));
    await signIn(request, github);

    const added = await postJson(request, "/api/workspaces", {
      name: "Side project again",
      repo: "octo-owner/side-project",
    });
    const unreached = await postJson(request, "/api/workspaces", {
      name: "Elsewhere",
      repo: "someone-else/elsewhere",
    });

    expect(added.status).toBe(409);
    expect(await errorOf(added)).toBe("The side-project workspace works on side-project already.");
    expect(unreached.status).toBe(400);
    expect(await errorOf(unreached)).toMatch(/GitHub App doesn't reach someone-else\/elsewhere/);
  });

  it("says why when the repo can't be got onto the worker machine, and makes no workspace", async () => {
    const github = createFakeGitHub({
      repos: [{ fullName: "octo-owner/gone", cloneUrl: join(root, "nowhere.git") }],
    });
    const request = await asOwner(testWorker({ root, github: github.api }));
    await signIn(request, github);

    const response = await postJson(request, "/api/workspaces", {
      name: "Gone",
      repo: "octo-owner/gone",
    });

    expect(response.status).toBe(502);
    expect(await errorOf(response)).toMatch(
      /^octo-owner\/gone couldn't be got onto this machine: /,
    );
    expect((await (await request("/api/workspaces/gone")).json()) as unknown).toMatchObject({
      error: expect.any(String),
    });
  });
});
