import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEvent } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Provider } from "./providers/index.ts";
import { err, ok } from "./result.ts";
import {
  asOwner,
  codeRepo,
  codeWorkspace,
  DRAWING_MODEL,
  drawingProvider,
  followSession,
  type PaperStep,
  pngOf,
  postJson,
  quotedInGuide,
  type Requester,
  testWorker,
} from "./testing.ts";

// Paper in code workspaces (#180, ADR 0023): a code workspace that names its Paper file has
// Paper's MCP server passed to its sessions' turns. A stand-in provider plays both the model and
// Paper, so the real Paper app never runs.

let root: string;
let repo: string;

/** Paper as a code workspace's config names it: its command and its file. */
const PAPER = { command: "/path/to/paper", fileId: "file-1" };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  ({ repo } = await codeRepo(root));
  await codeWorkspace(root, "side-project", repo, { connections: { paper: PAPER } });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

const start = async (providers: Provider[]) => asOwner(testWorker({ root, providers }));

/**
 * Starts a session in `workspace` on the drawer and follows its first turn to its end, answering
 * each approval it asks for with `answer`: its id and events.
 */
const firstTurn = async (
  request: Requester,
  options: { workspace?: string; answer?: "allow" | "deny" } = {},
) => {
  const response = await postJson(
    request,
    `/api/workspaces/${options.workspace ?? "side-project"}/sessions`,
    {
      text: "Draw the board",
      model: DRAWING_MODEL,
    },
  );
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  const events = await followSession(request, {
    sessionId: id,
    until: (event) => event.type === "turn-completed" || event.type === "turn-failed",
    onEvent: (event) => {
      if (event.type !== "approval-requested") return;
      void postJson(request, `/api/sessions/${id}/approvals/${event.seq}`, {
        answer: options.answer ?? "deny",
      });
    },
  });
  return { id, events };
};

/** A text result as Paper gives it, from its JSON. */
const json = (value: unknown) => [{ kind: "text" as const, text: JSON.stringify(value) }];

describe("a code workspace's Paper connection", () => {
  it("passes Paper's MCP server to its sessions' turns, from the command its config names", async () => {
    const { provider, turns } = drawingProvider([]);
    const request = await start([provider]);

    await firstTurn(request);

    expect(turns).toHaveLength(1);
    expect(
      turns[0]?.map((connection) => ({ name: connection.name, server: connection.server })),
    ).toEqual([{ name: "paper", server: { command: "/path/to/paper", args: ["mcp"] } }]);
  });

  it("isn't there for a code workspace that doesn't name one", async () => {
    await codeWorkspace(root, "side-project", repo);
    const { provider, turns } = drawingProvider([]);
    const request = await start([provider]);

    await firstTurn(request);

    expect(turns).toEqual([[]]);
  });

  it("isn't there in a planning workspace, even one whose config names it (not yet, ADR 0023)", async () => {
    await mkdir(join(root, "context", "garage-gym"), { recursive: true });
    await writeFile(
      join(root, "context", "garage-gym", "workspace.json"),
      JSON.stringify({ connections: { paper: PAPER } }),
    );
    const { provider, turns } = drawingProvider([]);
    const request = await start([provider]);

    await firstTurn(request, { workspace: "garage-gym" });

    expect(turns).toEqual([[]]);
  });
});

/** The activities in a turn's events. */
const activitiesIn = (events: readonly SessionEvent[]) =>
  events.flatMap((event) => (event.type === "activity" ? [event.activity] : []));

describe("Paper's tools in a code session", () => {
  it("read and draw in the workspace's file without asking, each shown as it works, and nowhere else", async () => {
    const { provider, answers } = drawingProvider([
      { tool: "get_guide", input: { topic: "paper-mcp-instructions" } },
      { tool: "get_basic_info", input: { fileId: "file-1" } },
      { tool: "create_artboard", input: { fileId: "file-1", name: "Board", styles: {} } },
      { tool: "get_basic_info", input: { fileId: "file-2" } },
      { tool: "get_basic_info", input: {} },
      { tool: "create_file", input: { name: "Another" } },
    ]);
    const request = await start([provider]);

    const { events } = await firstTurn(request);

    const onlyItsFile = await quotedInGuide("Paper's tools here work only", { file: '"file-1"' });
    expect(answers).toEqual([
      ok(null),
      ok(null),
      ok(null),
      err(onlyItsFile),
      err(onlyItsFile),
      err(await quotedInGuide("Paper's files can't be made")),
    ]);
    expect(activitiesIn(events)).toEqual([
      { kind: "used-tool", connection: "Paper", action: "get_guide" },
      { kind: "used-tool", connection: "Paper", action: "get_basic_info" },
      { kind: "used-tool", connection: "Paper", action: "create_artboard" },
    ]);
    expect(events.some((event) => event.type === "approval-requested")).toBe(false);
  });

  /** A board made, a row written into it and the board copied, then `nodeIds` deleted. */
  const makeThenDelete = (nodeIds: readonly string[]): PaperStep[] => [
    {
      tool: "create_artboard",
      input: { fileId: "file-1", name: "Board", styles: {} },
      output: json({ fileId: "file-1", id: "M-1", name: "Board", pageId: "P-1" }),
    },
    {
      tool: "write_html",
      input: { fileId: "file-1", html: "<div />", targetNodeId: "M-1", mode: "insert-children" },
      output: json({ fileId: "file-1", createdNodeIds: ["M-2"], parentId: "M-1" }),
    },
    {
      tool: "duplicate_nodes",
      input: { fileId: "file-1", nodes: [{ id: "M-1" }] },
      output: json({
        duplicated: [{ sourceId: "M-1", newId: "M-3" }],
        descendantIdMap: { "M-2": "M-4" },
      }),
    },
    { tool: "delete_nodes", input: { fileId: "file-1", nodeIds } },
  ];

  it("delete what the session made without asking", async () => {
    const { provider, answers } = drawingProvider(makeThenDelete(["M-1", "M-2", "M-3", "M-4"]));
    const request = await start([provider]);

    const { events } = await firstTurn(request);

    expect(answers.at(-1)).toEqual(ok(null));
    expect(events.some((event) => event.type === "approval-requested")).toBe(false);
    expect(activitiesIn(events).at(-1)).toEqual({
      kind: "used-tool",
      connection: "Paper",
      action: "delete_nodes",
    });
  });

  it("wait for the owner's approval to delete anything the session didn't make, naming what, and do it once allowed", async () => {
    const { provider, answers } = drawingProvider(makeThenDelete(["M-1", "B-7"]));
    const request = await start([provider]);

    const { events } = await firstTurn(request, { answer: "allow" });

    const asked = events.find((event) => event.type === "approval-requested");
    expect(asked).toMatchObject({
      ask: {
        kind: "tool",
        connection: "Paper",
        action: "delete_nodes",
        input: JSON.stringify({ fileId: "file-1", nodeIds: ["M-1", "B-7"] }),
        reason: "deletes-unmade",
      },
    });
    expect(answers.at(-1)).toEqual(ok(null));
    expect(activitiesIn(events).at(-1)).toEqual({
      kind: "used-tool",
      connection: "Paper",
      action: "delete_nodes",
    });
  });

  it("tell the model when the owner denies a delete, and delete nothing", async () => {
    const { provider, answers } = drawingProvider(makeThenDelete(["B-7"]));
    const request = await start([provider]);

    const { events } = await firstTurn(request, { answer: "deny" });

    expect(answers.at(-1)).toEqual(
      err(
        "The owner denied that, so it didn't happen. Find another way, or tell the owner why it's needed.",
      ),
    );
    expect(activitiesIn(events).map((activity) => activity)).not.toContainEqual({
      kind: "used-tool",
      connection: "Paper",
      action: "delete_nodes",
    });
  });

  it("say why a call may have failed: Paper isn't open on the worker machine", async () => {
    const { provider, added } = drawingProvider([
      { tool: "get_basic_info", input: { fileId: "file-1" }, fails: "fetch failed" },
      { tool: "get_basic_info", input: { fileId: "file-1" }, output: json({ fileId: "file-1" }) },
    ]);
    const request = await start([provider]);

    await firstTurn(request);

    expect(added).toEqual([
      await quotedInGuide("If that failed because Paper couldn't be reached"),
      undefined,
    ]);
  });
});

describe("a screenshot of a Paper board", () => {
  it("shows in the chat, kept with the session, with what it shows", async () => {
    const png = pngOf(4, 3, () => [200, 120, 40]);
    const { provider } = drawingProvider([
      {
        tool: "get_screenshot",
        input: { fileId: "file-1", nodeId: "M-1" },
        output: [
          { kind: "text", text: JSON.stringify({ fileId: "file-1" }) },
          {
            kind: "image",
            dataUrl: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
          },
        ],
      },
      // Not a PNG at all, so not shown.
      {
        tool: "get_screenshot",
        input: { fileId: "file-1", nodeId: "M-1" },
        output: [{ kind: "image", dataUrl: "data:image/png;base64,bm90IGEgcG5n" }],
      },
    ]);
    const request = await start([provider]);

    const { id, events } = await firstTurn(request);

    const shown = events.filter((event) => event.type === "image-shown");
    expect(shown).toEqual([
      expect.objectContaining({
        connection: "Paper",
        of: "M-1",
        image: expect.objectContaining({
          kind: "photo",
          name: "Paper screenshot.png",
          mediaType: "image/png",
          size: png.length,
        }),
      }),
    ]);
    const [first] = shown;
    if (first?.type !== "image-shown") throw new Error("nothing shown");
    const served = await request(`/api/sessions/${id}/attachments/${first.image.id}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await served.arrayBuffer()).equals(Buffer.from(png))).toBe(true);
  });
});
