import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Health } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorker } from "./worker.ts";

const settings = {
  COURTYARD_CONTEXT_DIR: "/path/to/context",
  COURTYARD_DATA_DIR: "/path/to/data",
};

const startWorker = (env: Record<string, string | undefined> = settings) => {
  const result = createWorker({ env });
  if (!result.ok) throw new Error(`expected the worker to start: ${result.error}`);
  return result.value;
};

const startupError = (env: Record<string, string | undefined>) => {
  const result = createWorker({ env });
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
  let root: string;
  let webDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "courtyard-"));
    webDir = join(root, "web");
    await mkdir(join(webDir, "assets"), { recursive: true });
    await writeFile(join(webDir, "index.html"), "<h1>Courtyard page</h1>");
    await writeFile(join(webDir, "assets", "app.js"), "console.log('app')");
    await writeFile(join(root, "secret.txt"), "outside the web folder");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
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
    const response = await startWithWebApp().app.request("/api/nothing-here");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("never serves a file from outside the web folder", async () => {
    const { app } = startWithWebApp();

    for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2fsecret.txt"]) {
      const response = await app.request(path);
      expect(await response.text()).not.toContain("outside the web folder");
    }
  });
});
