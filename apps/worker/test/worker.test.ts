import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { Agent, get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { Health } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serveWorker } from "../src/start.ts";
import { createWorker, type Environment } from "../src/worker.ts";
import { asOwner, errorOf, removeTestFolder } from "./testing.ts";

let root: string;
let settings: Environment;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context"));
  await mkdir(join(root, "data"));
  settings = {
    COURTYARD_CONTEXT_DIR: join(root, "context"),
    COURTYARD_DATA_DIR: join(root, "data"),
  };
});

afterEach(async () => {
  await removeTestFolder(root);
});

const startWorker = (env: Environment = settings) => {
  const result = createWorker({ env, repeat: () => {}, mattSkills: null });
  if (!result.ok) throw new Error(`expected the worker to start: ${result.error}`);
  return result.value;
};

const startupError = (env: Environment) => {
  const result = createWorker({ env, repeat: () => {}, mattSkills: null });
  if (result.ok) throw new Error("expected the worker to refuse these settings");
  return result.error;
};

describe("settings", () => {
  it("refuses to start without the required folders, naming each one", () => {
    const error = startupError({});

    expect(error).toContain("COURTYARD_CONTEXT_DIR");
    expect(error).toContain("COURTYARD_DATA_DIR");
  });

  it("names a bad port without repeating its value", () => {
    const error = startupError({ ...settings, COURTYARD_PORT: "not-a-port-7Qz" });

    expect(error).toContain("COURTYARD_PORT");
    expect(error).not.toContain("not-a-port-7Qz");
  });

  it("listens on port 8787 unless told otherwise", () => {
    expect(startWorker().port).toBe(8787);
    expect(startWorker({ ...settings, COURTYARD_PORT: "9100" }).port).toBe(9100);
  });

  it("names preview ports that aren't a port or a range of them (#183)", () => {
    for (const ports of ["9906-9901", "nine", "9901-99999", "1-500"]) {
      const error = startupError({ ...settings, COURTYARD_PREVIEW_PORTS: ports });

      expect(error).toContain("COURTYARD_PREVIEW_PORTS");
    }
    startWorker({ ...settings, COURTYARD_PREVIEW_PORTS: "9901-9906" });
    startWorker({ ...settings, COURTYARD_PREVIEW_PORTS: "9950" });
  });

  it("refuses a context folder that doesn't exist", () => {
    const error = startupError({ ...settings, COURTYARD_CONTEXT_DIR: join(root, "missing") });

    expect(error).toContain("COURTYARD_CONTEXT_DIR");
  });

  it("refuses a context folder that is a file", async () => {
    await writeFile(join(root, "a-file"), "");

    const error = startupError({ ...settings, COURTYARD_CONTEXT_DIR: join(root, "a-file") });

    expect(error).toContain("COURTYARD_CONTEXT_DIR");
  });

  it("creates its data folder when it doesn't exist yet", () => {
    const dataDir = join(root, "new-data");

    startWorker({ ...settings, COURTYARD_DATA_DIR: dataDir });

    expect(existsSync(dataDir)).toBe(true);
  });

  it("takes 1 or 0 for whether to offer Codex, and nothing else", () => {
    expect(startupError({ ...settings, COURTYARD_CODEX_PROVIDER: "off" })).toContain(
      "COURTYARD_CODEX_PROVIDER must be 1 or 0",
    );
  });

  it("takes a whole number of builds at once, 1 or more, and nothing else (#281)", () => {
    for (const value of ["0", "1.5", "two"]) {
      expect(startupError({ ...settings, COURTYARD_BUILDS_AT_ONCE: value })).toContain(
        "COURTYARD_BUILDS_AT_ONCE must be a whole number, 1 or more",
      );
    }
    expect(startWorker({ ...settings, COURTYARD_BUILDS_AT_ONCE: "2" })).toBeDefined();
  });

  it("refuses a web app folder that was set but doesn't exist", () => {
    const error = startupError({ ...settings, COURTYARD_WEB_DIR: join(root, "no-build") });

    expect(error).toContain("COURTYARD_WEB_DIR");
  });
});

describe("health check", () => {
  it("says the worker is up, without a login", async () => {
    const { app } = startWorker();

    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    expect(Health.parse(await response.json())).toEqual({ status: "ok" });
  });
});

describe("the web app", () => {
  let webDir: string;

  beforeEach(async () => {
    webDir = join(root, "web");
    await mkdir(join(webDir, "assets"), { recursive: true });
    await writeFile(join(webDir, "index.html"), "<h1>Courtyard page</h1>");
    await writeFile(join(webDir, "assets", "app.js"), "console.log('app')");
    await writeFile(join(root, "secret.txt"), "outside the web folder");
  });

  const startWithWebApp = () => startWorker({ ...settings, COURTYARD_WEB_DIR: webDir });

  it("serves the page at the root", async () => {
    const response = await startWithWebApp().app.request("/");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Courtyard page");
  });

  it("serves the page for the app's own routes, so a reload works", async () => {
    const response = await startWithWebApp().app.request("/workspaces/garage");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Courtyard page");
  });

  it("serves the app's files with their type", async () => {
    const response = await startWithWebApp().app.request("/assets/app.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    expect(await response.text()).toBe("console.log('app')");
  });

  it("answers an unknown API path with a JSON 404, not the page", async () => {
    const response = await (await asOwner(startWithWebApp().app))("/api/nothing-here");

    expect(response.status).toBe(404);
    expect(await errorOf(response)).toBe("Not found");
  });

  it("never serves a file from outside the web folder", async () => {
    const { app } = startWithWebApp();

    for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2fsecret.txt"]) {
      const response = await app.request(path);
      expect(await response.text()).not.toContain("outside the web folder");
    }
  });
});

describe("Fabrication (#698)", () => {
  let fabricationDir: string;

  beforeEach(async () => {
    const webDir = join(root, "web");
    await mkdir(webDir, { recursive: true });
    await writeFile(join(webDir, "index.html"), "<h1>Courtyard page</h1>");
    fabricationDir = join(root, "fabrication");
    await mkdir(join(fabricationDir, "assets"), { recursive: true });
    await writeFile(join(fabricationDir, "index.html"), "<h1>Fabrication page</h1>");
    await writeFile(join(fabricationDir, "assets", "app.js"), "console.log('fabrication')");
    await writeFile(join(root, "secret.txt"), "outside the Fabrication folder");
  });

  const startWithFabrication = () =>
    startWorker({
      ...settings,
      COURTYARD_WEB_DIR: join(root, "web"),
      COURTYARD_FABRICATION_DIR: fabricationDir,
    }).app;

  it("serves its page under /fabrication, for each of its own routes, and the web app's elsewhere", async () => {
    const app = startWithFabrication();

    for (const path of ["/fabrication", "/fabrication/", "/fabrication/workspaces/garage/builds/workbench"]) {
      expect(await (await app.request(path)).text()).toContain("Fabrication page");
    }
    expect(await (await app.request("/fabrications")).text()).toContain("Courtyard page");
    expect(await (await app.request("/workspaces/garage")).text()).toContain("Courtyard page");
  });

  it("serves its files with their type, and none from outside its folder", async () => {
    const app = startWithFabrication();

    const file = await app.request("/fabrication/assets/app.js");
    expect(file.headers.get("content-type")).toContain("javascript");
    expect(await file.text()).toBe("console.log('fabrication')");
    for (const path of ["/fabrication/../secret.txt", "/fabrication/assets/..%2f..%2fsecret.txt"]) {
      expect(await (await app.request(path)).text()).not.toContain("outside the Fabrication");
    }
  });

  it("refuses a Fabrication folder that was set but doesn't exist", () => {
    const error = startupError({ ...settings, COURTYARD_FABRICATION_DIR: join(root, "no-build") });

    expect(error).toContain("COURTYARD_FABRICATION_DIR");
  });
});

describe("served behind a proxy", () => {
  /** Asks for the health check over `agent`, saying whether it went on a connection already open. */
  const askHealth = (port: number, agent: Agent) =>
    new Promise<{ status: number | undefined; reused: boolean }>((resolve, reject) => {
      const asking = get({ port, path: "/api/health", agent }, (response) => {
        response.resume();
        response.on("end", () =>
          resolve({ status: response.statusCode, reused: asking.reusedSocket }),
        );
      });
      asking.on("error", reject);
    });

  // A proxy keeps an idle connection to the worker open to use again (Caddy, for 2 minutes). Had
  // the worker closed it first, the proxy's next request on it could fail, as a 502 (#204).
  it("keeps an idle connection open longer than a proxy does", async () => {
    const server = serveWorker({ app: startWorker().app, port: 0 });
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const first = await askHealth(address.port, agent);
      // Longer than Node's own 5 seconds.
      await wait(6000);
      const later = await askHealth(address.port, agent);

      expect(first).toEqual({ status: 200, reused: false });
      expect(later).toEqual({ status: 200, reused: true });
    } finally {
      agent.destroy();
      server.close();
    }
  }, 20_000);
});
