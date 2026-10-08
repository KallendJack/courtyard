import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignInList } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "./providers/index.ts";
import {
  asOwner,
  errorOf,
  postJson,
  type Requester,
  requesterFor,
  setUpOwner,
  testWorker,
} from "./testing.ts";

// Signing in to a provider whose sign-in Courtyard handles, from the home page (ADR 0015).

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A worker offering a fake that can sign in, and one that can't. */
const workerWith = (finishAfterMs?: number) =>
  testWorker({
    root,
    providers: [
      createFakeProvider({ signIn: finishAfterMs === undefined ? {} : { finishAfterMs } }),
    ],
  });

const signIns = async (request: Requester) =>
  SignInList.parse(await (await request("/api/sign-ins")).json()).signIns;

describe("signing in from the home page", () => {
  it("lists each provider Courtyard signs in to, and where its sign-in stands", async () => {
    const request = await asOwner(workerWith());

    expect(await signIns(request)).toEqual([
      {
        provider: "fake",
        label: "Fake",
        service: "Fake",
        state: { kind: "signed-out" },
        notNow: false,
      },
    ]);
  });

  it("starts a sign-in, giving its link and code, and cancels it", async () => {
    const request = await asOwner(workerWith());

    const started = await postJson(request, "/api/sign-ins/fake/start", {});
    const waiting = await signIns(request);
    const cancelled = await postJson(request, "/api/sign-ins/fake/cancel", {});

    expect(started.status).toBe(200);
    expect(await started.json()).toMatchObject({
      provider: "fake",
      state: { kind: "waiting", link: "https://courtyard.example/device", code: "FAKE-2026" },
    });
    expect(waiting[0]?.state).toMatchObject({ kind: "waiting" });
    expect(cancelled.status).toBe(204);
    expect((await signIns(request))[0]?.state).toEqual({ kind: "signed-out" });
  });

  it("shows the sign-in finished once the owner has finished it on their device", async () => {
    const request = await asOwner(workerWith(0));

    await postJson(request, "/api/sign-ins/fake/start", {});
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect((await signIns(request))[0]?.state).toEqual({
      kind: "signed-in",
      email: "owner@courtyard.example",
      plan: "pretend",
    });
  });

  it("signs out", async () => {
    const request = await asOwner(workerWith(0));
    await postJson(request, "/api/sign-ins/fake/start", {});
    await new Promise((resolve) => setTimeout(resolve, 20));

    const signedOut = await postJson(request, "/api/sign-ins/fake/sign-out", {});

    expect(signedOut.status).toBe(204);
    expect((await signIns(request))[0]?.state).toEqual({ kind: "signed-out" });
  });

  it("remembers Not now in the data folder, across a restart", async () => {
    const app = workerWith();
    const cookie = await setUpOwner(app);

    const dismissed = await postJson(requesterFor(app, cookie), "/api/sign-ins/fake/not-now", {});
    // The same device, logged in, on a worker started again on the same folders.
    const restarted = requesterFor(workerWith(), cookie);

    expect(dismissed.status).toBe(204);
    expect((await signIns(restarted))[0]?.notNow).toBe(true);
  });

  it("forgets Not now once the owner signs in after all, so a later lapse asks again", async () => {
    const request = await asOwner(workerWith());
    await postJson(request, "/api/sign-ins/fake/not-now", {});

    await postJson(request, "/api/sign-ins/fake/start", {});

    expect((await signIns(request))[0]?.notNow).toBe(false);
  });

  it("says when a provider has no sign-in Courtyard handles", async () => {
    const request = await asOwner(testWorker({ root, providers: [createFakeProvider()] }));

    const started = await postJson(request, "/api/sign-ins/fake/start", {});

    expect(await signIns(request)).toEqual([]);
    expect(started.status).toBe(404);
    expect(await errorOf(started)).toBe("There's no sign-in for that provider.");
  });

  it("needs the owner's login", async () => {
    const app = workerWith();

    const response = await app.request("/api/sign-ins");

    expect(response.status).toBe(401);
  });
});
