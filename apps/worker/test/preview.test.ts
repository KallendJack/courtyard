import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Preview, type SessionEvent } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Screenshot } from "../src/features/preview/screenshot.ts";
import { ok } from "../src/lib/result.ts";
import { createFakeProvider } from "../src/providers/fake.ts";
import { pngOf } from "./test-files.ts";
import {
  codeRepo,
  codeWorkspace,
  FAKE_MODEL,
  followSession,
  gitIn,
  postJson,
  quotedInGuide,
  type Requester,
  removeTestFolder,
  requesterFor,
  setUpOwner,
  testWorker,
} from "./testing.ts";

// Previewing a code session's running app from the phone (#183): a task serving a web page, reached
// through a port of the worker's own, behind the owner's login, only while the task runs.

let root: string;

/**
 * A small app the repository serves, as a dev server does: it listens on `PORT`, prints its
 * address as Vite does (the port in bold), and answers with its page, the cookies it was sent, and
 * a login cookie of its own named as Courtyard's is.
 */
const SITE = `import { createServer } from "node:http";
const server = createServer((request, response) => {
  if (request.url === "/cookies") return response.end(request.headers.cookie ?? "");
  if (request.url === "/log-in") {
    response.setHeader("set-cookie", "courtyard_login=inside; Path=/; HttpOnly");
    return response.end("Logged in");
  }
  response.setHeader("content-type", "text/html");
  response.end("<h1>Side project</h1><p>Host " + request.headers.host + "</p>");
});
server.on("upgrade", (request, socket) => {
  socket.write("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n\\r\\n");
  socket.on("data", (data) => socket.write("echo " + data));
});
server.listen(Number(process.env.PORT ?? 0), "localhost", () => {
  console.log("  VITE ready");
  console.log("  ➜  Local:   http://localhost:\\u001b[1m" + server.address().port + "\\u001b[22m/");
});
`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  const { repo } = await codeRepo(root);
  await mkdir(join(repo, "scripts"));
  await writeFile(join(repo, "scripts", "site.mjs"), SITE);
  await writeFile(
    join(repo, "package.json"),
    JSON.stringify({ name: "side-project", scripts: { dev: "node scripts/site.mjs" } }),
  );
  await writeFile(join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await gitIn(repo, "add", ".");
  await gitIn(repo, "commit", "--quiet", "-m", "A site");
  await gitIn(repo, "push", "--quiet", "origin", "main");
  await codeWorkspace(root, "side-project", repo);
});

afterEach(async () => {
  await removeTestFolder(root);
});

/** A screenshot as the stand-in for Chromium takes it: what it was asked. */
type Shot = Parameters<Screenshot>[0];

const start = async () => {
  const shots: Shot[] = [];
  const app = testWorker({
    root,
    providers: [createFakeProvider({ delayMs: 0 })],
    screenshot: async (shot) => {
      shots.push(shot);
      return ok(pngOf(4, 4, () => [122, 92, 255]));
    },
  });
  const cookie = await setUpOwner(app);
  return { request: requesterFor(app, cookie), cookie, shots };
};

/** Sends the session `text` once its last turn has ended: the events of the turn it starts. */
const send = async (request: Requester, id: string, text: string) => {
  const before = await followSession(request, { sessionId: id, until: "turn-completed" });
  const sent = await postJson(request, `/api/sessions/${id}/messages`, { text, model: FAKE_MODEL });
  expect(sent.status).toBe(202);
  return followSession(request, {
    sessionId: id,
    after: before.at(-1)?.seq ?? 0,
    until: "turn-completed",
  });
};

/** What the fake answered in some events. */
const answerIn = (events: readonly SessionEvent[]) =>
  events.flatMap((event) => (event.type === "text-delta" ? [event.text] : [])).join("");

/** Starts a session in the code workspace with `text`, once its first turn has ended: its id. */
const sessionWith = async (request: Requester, text: string) => {
  const response = await postJson(request, "/api/workspaces/side-project/sessions", {
    text,
    model: FAKE_MODEL,
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  await followSession(request, { sessionId: id, until: "turn-completed" });
  return id;
};

/** The session's preview, as its page asks. */
const previewOf = async (request: Requester, id: string) => {
  const response = await request(`/api/sessions/${id}/preview`);
  expect(response.status).toBe(200);
  return Preview.parse(await response.json());
};

describe("a code session's preview", () => {
  it("offers Start preview with the repository's dev script, until the owner confirms it once", async () => {
    const { request } = await start();
    const id = await sessionWith(request, "Hello");

    expect(await previewOf(request, id)).toEqual({
      kind: "none",
      command: "pnpm dev",
      confirmed: false,
    });
  });

  it("starts with the owner's tap, kept as the workspace's, and serves the app on a port of its own behind the owner's login", async () => {
    const { request, cookie } = await start();
    const id = await sessionWith(request, "Hello");

    const started = await postJson(request, `/api/sessions/${id}/preview`, {
      command: "node scripts/site.mjs",
    });

    expect(started.status).toBe(201);
    const config = JSON.parse(
      await readFile(join(root, "context", "side-project", "workspace.json"), "utf8"),
    );
    expect(config.preview).toBe("node scripts/site.mjs");
    const serving = await servingOf(request, id);
    const page = await fetch(`http://localhost:${serving.port}/`, { headers: { cookie } });
    expect(page.status).toBe(200);
    // The app is asked as on its own address, so a dev server that checks its host lets it in.
    expect(await page.text()).toMatch(/^<h1>Side project<\/h1><p>Host localhost:\d+<\/p>$/);
    // Logged out, nothing reaches the app.
    const loggedOut = await fetch(`http://localhost:${serving.port}/`);
    expect(loggedOut.status).toBe(401);
    // Courtyard's login never reaches the app.
    const sent = await fetch(`http://localhost:${serving.port}/cookies`, {
      headers: { cookie: `${cookie}; theme=dark` },
    });
    expect(await sent.text()).toBe("theme=dark");

    await stopPreview(request, id, serving.task);
  });

  it("closes as its task ends, which tells nobody; the next Start preview offers the command kept", async () => {
    const { request, cookie } = await start();
    const id = await sessionWith(request, "Hello");
    await postJson(request, `/api/sessions/${id}/preview`, { command: "node scripts/site.mjs" });
    const serving = await servingOf(request, id);

    await stopPreview(request, id, serving.task);

    await expect(
      fetch(`http://localhost:${serving.port}/`, { headers: { cookie } }),
    ).rejects.toThrow();
    expect(await previewOf(request, id)).toEqual({
      kind: "none",
      command: "node scripts/site.mjs",
      confirmed: true,
    });
    const events = await followSession(request, { sessionId: id, until: "task-ended" });
    expect(events.find((event) => event.type === "task-started")).toMatchObject({
      command: "node scripts/site.mjs",
      preview: true,
    });
    expect(events.filter((event) => event.type === "owner-message")).toHaveLength(1);
  });

  it("shows a task the model started once it serves a page, and passes live reload through", async () => {
    const { request, cookie } = await start();
    const id = await sessionWith(request, "start task: node scripts/site.mjs");

    const serving = await servingOf(request, id);

    const reply = await upgradeThrough(serving.port, cookie);
    expect(reply).toContain("HTTP/1.1 101");
    expect(reply).toContain("echo hello");
    // Logged out, it's refused.
    expect(await upgradeThrough(serving.port, undefined)).toMatch(/^HTTP\/1.1 401/);
    await stopPreview(request, id, serving.task);
  });

  it("keeps the app's own login cookie apart from Courtyard's, which it would otherwise replace", async () => {
    const { request, cookie } = await start();
    const id = await sessionWith(request, "Hello");
    await postJson(request, `/api/sessions/${id}/preview`, { command: "node scripts/site.mjs" });
    const serving = await servingOf(request, id);

    const loggedIn = await fetch(`http://localhost:${serving.port}/log-in`, {
      headers: { cookie },
    });

    const set = loggedIn.headers.get("set-cookie") ?? "";
    expect(set).toMatch(/^courtyard_login_preview=inside;/);
    // Sent back, the app has it by its own name again, and never Courtyard's.
    const sent = await fetch(`http://localhost:${serving.port}/cookies`, {
      headers: { cookie: `${cookie}; courtyard_login_preview=inside` },
    });
    expect(await sent.text()).toBe("courtyard_login=inside");
    await stopPreview(request, id, serving.task);
  });
});

describe("the model's screenshots of the preview", () => {
  it("are of a page at a size, as the owner sees it, and show in the chat", async () => {
    const { request, cookie, shots } = await start();
    const id = await sessionWith(request, "Hello");
    await postJson(request, `/api/sessions/${id}/preview`, { command: "node scripts/site.mjs" });
    const serving = await servingOf(request, id);
    // The owner has the page open, logged in to the app.
    await fetch(`http://localhost:${serving.port}/`, {
      headers: { cookie: `${cookie}; courtyard_login_preview=inside` },
    });

    const events = await send(request, id, "preview screenshot: /things cover");

    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({
      path: "/things",
      viewport: { width: 400, height: 640 },
      cookies: "courtyard_login=inside",
    });
    expect(answerIn(events)).toContain(
      `Preview: ${await quotedInGuide("Here's <path> at the <size> size", { path: "/things", size: "cover" })}`,
    );
    expect(events.find((event) => event.type === "image-shown")).toMatchObject({
      connection: "Preview",
      of: "/things · cover",
      image: { mediaType: "image/png" },
    });
    await stopPreview(request, id, serving.task);
  });

  it("tell the model when nothing serves a page, and when what it gave doesn't fit", async () => {
    const { request, shots } = await start();
    const id = await sessionWith(request, "Hello");

    const events = await send(
      request,
      id,
      ["preview screenshot: / desktop", "preview screenshot: / huge"].join("\n"),
    );

    expect(shots).toHaveLength(0);
    expect(answerIn(events)).toContain(
      `Preview: ${await quotedInGuide("Nothing in this session serves a web page now")}`,
    );
    expect(answerIn(events)).toContain(
      `Preview: ${await quotedInGuide("That input doesn't fit this tool: it takes a page's path")}`,
    );
  });
});

/**
 * Asks the preview's port for a WebSocket, as live reload does, with the owner's login cookie or
 * none, and says hello once it's open: everything that came back.
 */
const upgradeThrough = (port: number, cookie: string | undefined) =>
  new Promise<string>((resolve, reject) => {
    const socket = connect(port, "localhost", () => {
      socket.write(
        [
          "GET /live HTTP/1.1",
          `Host: localhost:${port}`,
          "Connection: Upgrade",
          "Upgrade: websocket",
          ...(cookie === undefined ? [] : [`Cookie: ${cookie}`]),
          "",
          "",
        ].join("\r\n"),
      );
    });
    let heard = "";
    socket.on("data", (data) => {
      heard += data.toString();
      if (heard.includes("101") && !heard.includes("echo")) socket.write("hello");
      if (heard.includes("echo hello")) socket.destroy();
    });
    socket.on("close", () => resolve(heard));
    socket.on("error", reject);
  });

/** The session's preview once it serves. */
const servingOf = async (request: Requester, id: string) => {
  let preview = await previewOf(request, id);
  await expect
    .poll(async () => {
      preview = await previewOf(request, id);
      return preview.kind;
    })
    .toBe("serving");
  if (preview.kind !== "serving") throw new Error("It never served");
  return preview;
};

/** Stops the preview's task, as the owner's Stop does. */
const stopPreview = async (request: Requester, id: string, task: string) => {
  const stopped = await postJson(request, `/api/sessions/${id}/tasks/${task}/stop`, {});
  expect(stopped.status).toBe(204);
};
