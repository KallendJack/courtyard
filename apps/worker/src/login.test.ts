import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, AuthState } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginCookie, testWorker } from "./testing.ts";

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
const startWorker = () => testWorker({ root, now: () => now });

const post = (path: string, body: unknown, cookie?: string) =>
  startWorker().request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

const get = (path: string, cookie?: string) =>
  startWorker().request(path, cookie ? { headers: { cookie } } : {});

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

describe("review fixes", () => {
  it("slows down wrong passwords sent all at once", async () => {
    const app = startWorker();
    await setUp();
    const guess = (password: string) =>
      app.request("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });

    await Promise.all(Array.from({ length: 6 }, () => guess("wrong password")));

    expect((await guess(PASSWORD)).status).toBe(429);
  });

  it("forgets wrong passwords after an hour", async () => {
    await setUp();
    for (let i = 0; i < 3; i++) await post("/api/login", { password: "wrong password" });

    now += 61 * 60 * 1000;
    for (let i = 0; i < 3; i++) await post("/api/login", { password: "wrong password" });

    expect((await post("/api/login", { password: PASSWORD })).status).toBe(200);
  });

  it("refuses a setup sent from another site", async () => {
    const asText = await startWorker().request("/api/setup", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const fromElsewhere = await startWorker().request("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://elsewhere.example" },
      body: JSON.stringify({ password: PASSWORD }),
    });

    expect(asText.status).toBe(415);
    expect(fromElsewhere.status).toBe(403);
    expect(await authState()).toBe("setup-needed");
  });

  it("accepts a setup through an HTTPS reverse proxy, and still refuses other sites", async () => {
    // The proxy answers HTTPS and forwards plain HTTP, saying so in X-Forwarded-Proto.
    const through = (origin: string) =>
      startWorker().request("http://courtyard.example/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-proto": "https", origin },
        body: JSON.stringify({ password: PASSWORD }),
      });

    expect((await through("https://elsewhere.example")).status).toBe(403);
    expect((await through("http://courtyard.example")).status).toBe(403);
    const fromItself = await through("https://courtyard.example");

    expect(fromItself.status).toBe(201);
    expect(fromItself.headers.get("set-cookie")).toMatch(/; Secure/);
  });

  it("refuses a password longer than 1,024 characters", async () => {
    expect((await post("/api/setup", { password: "x".repeat(1025) })).status).toBe(400);
  });

  it("logs out every other device, so a lost one can be cut off", async () => {
    const first = await setUp();
    const second = loginCookie(await post("/api/login", { password: PASSWORD }));
    const third = loginCookie(await post("/api/login", { password: PASSWORD }));

    expect((await post("/api/logout-others", {}, second)).status).toBe(204);

    expect(await authState(first)).toBe("logged-out");
    expect(await authState(third)).toBe("logged-out");
    expect(await authState(second)).toBe("logged-in");
  });

  it("renews a device's cookie whenever it checks in, so a device in use never drops out", async () => {
    const cookie = await setUp();

    const response = await get("/api/auth", cookie);

    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=34560000/);
  });

  it("reports a damaged owner file instead of crashing", async () => {
    await setUp();
    await writeFile(join(root, "data", "owner.json"), "{ damaged");

    for (const response of [
      await get("/api/auth"),
      await post("/api/login", { password: PASSWORD }),
    ]) {
      expect(response.status).toBe(500);
      expect(ApiError.safeParse(await response.json()).success).toBe(true);
    }
  });
});
