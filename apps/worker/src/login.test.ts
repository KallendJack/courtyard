import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, AuthState } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorker } from "./worker.ts";

const PASSWORD = "correct horse battery";

let root: string;
let now: number;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context"));
  now = Date.parse("2026-10-05T12:00:00Z");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A worker on the same folders as every other in this test, like one restarted. */
const startWorker = () => {
  const worker = createWorker({
    env: { COURTYARD_CONTEXT_DIR: join(root, "context"), COURTYARD_DATA_DIR: join(root, "data") },
    now: () => now,
  });
  if (!worker.ok) throw new Error(worker.error);
  return worker.value.app;
};

const post = (path: string, body: unknown, cookie?: string) =>
  startWorker().request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

const get = (path: string, cookie?: string) =>
  startWorker().request(path, cookie ? { headers: { cookie } } : {});

/** The `name=value` part of the login cookie a response set. */
const loginCookie = (response: Response) => {
  const header = response.headers.get("set-cookie") ?? "";
  const match = /(courtyard_login=[^;]+)/.exec(header);
  if (!match?.[1]) throw new Error(`no login cookie in: ${header}`);
  return match[1];
};

const authState = async (cookie?: string) =>
  AuthState.parse(await (await get("/api/auth", cookie)).json()).state;

const setUp = async () => loginCookie(await post("/api/setup", { password: PASSWORD }));

describe("first-run setup", () => {
  it("asks for setup on a fresh install, with no default password", async () => {
    expect(await authState()).toBe("setup-needed");
    expect((await post("/api/login", { password: "" })).status).toBe(409);
  });

  it("creates the owner and logs this device in", async () => {
    const response = await post("/api/setup", { password: PASSWORD });

    expect(response.status).toBe(201);
    const header = response.headers.get("set-cookie") ?? "";
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Strict/i);
    expect(await authState(loginCookie(response))).toBe("logged-in");
  });

  it("happens only once", async () => {
    await setUp();

    const again = await post("/api/setup", { password: "a different password" });

    expect(again.status).toBe(409);
    expect(await authState()).toBe("logged-out");
  });

  it("refuses a password shorter than 8 characters", async () => {
    const response = await post("/api/setup", { password: "short" });

    expect(response.status).toBe(400);
    expect(ApiError.parse(await response.json()).error).toContain("8");
    expect(await authState()).toBe("setup-needed");
  });

  it("stores only a slow hash of the password", async () => {
    await setUp();

    const files = await readdir(join(root, "data"));
    const contents = await Promise.all(files.map((f) => readFile(join(root, "data", f), "utf8")));
    for (const content of contents) expect(content).not.toContain(PASSWORD);
    expect(contents.join("\n")).toContain("scrypt");
  });
});

describe("logging in", () => {
  it("refuses every API route but the health check and login without a login", async () => {
    await setUp();

    expect((await get("/api/health")).status).toBe(200);
    expect((await get("/api/auth")).status).toBe(200);
    for (const path of ["/api/workspaces", "/api/workspaces/anything", "/api/nothing-here"]) {
      const response = await get(path);
      expect(response.status).toBe(401);
      expect(ApiError.safeParse(await response.json()).success).toBe(true);
    }
  });

  it("refuses a made-up login cookie", async () => {
    await setUp();

    expect((await get("/api/workspaces", "courtyard_login=made-up")).status).toBe(401);
  });

  it("logs a device in with the right password, and the login survives a restart", async () => {
    await setUp();

    const response = await post("/api/login", { password: PASSWORD });

    expect(response.status).toBe(200);
    // Every request in these tests goes to a newly started worker on the same folders.
    expect((await get("/api/workspaces", loginCookie(response))).status).toBe(200);
  });

  it("refuses the wrong password", async () => {
    await setUp();

    const response = await post("/api/login", { password: "wrong password" });

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("slowing down guesses", () => {
  const guess = (password = "wrong password") => post("/api/login", { password });

  it("lets three wrong passwords through, then makes each further one wait longer", async () => {
    await setUp();
    for (let i = 0; i < 3; i++) expect((await guess()).status).toBe(401);

    expect((await guess()).status).toBe(401);
    const blocked = await guess(PASSWORD);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);

    now += 1_000;
    expect((await guess()).status).toBe(401);
    now += 1_000;
    expect((await guess(PASSWORD)).status).toBe(429);
    now += 1_000;
    expect((await guess(PASSWORD)).status).toBe(200);
  });

  it("starts counting again after a right password", async () => {
    await setUp();
    for (let i = 0; i < 3; i++) await guess();
    expect((await guess(PASSWORD)).status).toBe(200);

    for (let i = 0; i < 3; i++) expect((await guess()).status).toBe(401);
    expect((await guess(PASSWORD)).status).toBe(200);
  });
});

describe("logging out", () => {
  it("logs out only the device that asks", async () => {
    const first = await setUp();
    const second = loginCookie(await post("/api/login", { password: PASSWORD }));

    const response = await post("/api/logout", {}, first);

    expect(response.status).toBe(204);
    expect(await authState(first)).toBe("logged-out");
    expect(await authState(second)).toBe("logged-in");
  });
});
