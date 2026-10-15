import { join } from "node:path";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

// Helpers (#117, ADR 0027), in the Side project code workspace start-worker.mjs sets up. The fake
// starts a helper with "helper <name>: <step> | <step>", its steps as the model's own lines are
// written ("read file: …", "run command: …"), "hold command: …" keeping a build running and
// "hold" holding it until the turn is stopped, and "report: …" its final report.

test.use({ viewport: { width: 950, height: 712 }, hasTouch: true, isMobile: true });

/** The sessions a test started, stopped after it so none holds a code session's slot or a build. */
const started: string[] = [];

test.afterEach(async ({ request }) => {
  for (const id of started.splice(0)) {
    await request.post(`/api/sessions/${id}/stop`, { data: { turn: 1 } });
  }
});

/** Starts a session in Side project on the fake with `lines`, and opens it. */
const openCoding = async (page: Page, request: APIRequestContext, lines: readonly string[]) => {
  const response = await request.post("/api/workspaces/side-project/sessions", {
    data: { text: lines.join("\n"), model: { provider: "fake", model: "echo" } },
  });
  expect(response.status()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  started.push(id);
  await page.goto(`/workspaces/side-project/sessions/${id}`);
  return id;
};

/** A helper's line, by its name. */
const helperLine = (page: Page, name: string) =>
  page.getByRole("region", { name: "Helpers" }).getByRole("listitem", { name: `Helper · ${name}` });

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};

test("each helper shows on a line of its own, opens on what it did and its report, and stops with the turn", async ({
  page,
  request,
}) => {
  const id = await openCoding(page, request, [
    "read file: notes.md",
    "helper Review against standards: read file: src/slots.ts | read file: src/page.tsx | report: Follows the standards.",
    "helper Review against the spec: read file: docs/spec.md | report: Matches the spec, except one thing: closing a running session should ask first.",
    "helper Run the unit tests: hold command: pnpm test",
    "helper Check the e2e tests: run command: pnpm e2e",
    "helper Look over the styles: hold",
    "helper Find similar slot code: read file: src/slots.ts",
  ]);
  const helpers = page.getByRole("region", { name: "Helpers" });

  // The model's own work stays on its own lines, before the helpers it asked for.
  await expect(page.getByRole("list", { name: "What the model did" })).toHaveText("Read notes.md");
  await expect(helpers).toContainText("Asked for 6 helpers");
  await expect(helperLine(page, "Review against standards")).toContainText("Done · 2 steps");
  await expect(helperLine(page, "Review against the spec")).toContainText("Done · 1 step");
  await expect(helperLine(page, "Check the e2e tests")).toContainText(
    /Waiting for a build · \d+ ahead/,
  );
  await expect(helperLine(page, "Find similar slot code")).toContainText(
    "Waiting for a helper to finish",
  );

  // Opened, a line shows what its helper did, then its report; and so after a reload.
  for (const reloaded of [false, true]) {
    if (reloaded) await page.reload();
    const spec = helperLine(page, "Review against the spec");
    await spec.getByRole("button").click();
    await expect(spec.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    await expect(spec).toContainText("Read docs/spec.md");
    await expect(spec).toContainText("Matches the spec, except one thing");
    await expect(helperLine(page, "Look over the styles")).toContainText("Working");
  }
  await shot(page, "helpers-at-work");

  await request.post(`/api/sessions/${id}/stop`, { data: { turn: 1 } });

  for (const name of ["Run the unit tests", "Check the e2e tests", "Find similar slot code"]) {
    await expect(helperLine(page, name)).toContainText("Stopped");
  }
  await expect(helperLine(page, "Review against standards")).toContainText("Done · 2 steps");
});

test("a helper's approval names it, its line waits on the owner, and Deny lets it report back", async ({
  page,
  request,
}) => {
  await openCoding(page, request, [
    "helper Review against standards: read file: src/slots.ts | report: Follows the standards.",
    "helper Check the e2e tests: run command: pnpm exec playwright install chromium (for: Installs the browser the e2e tests run in)",
  ]);
  const card = page.getByRole("region", { name: "Needs your OK" });

  await expect(card).toContainText("Needs your OK · Helper · Check the e2e tests");
  await expect(card).toContainText("Run a command? It isn't on the allowlist.");
  await expect(card.getByRole("code")).toHaveText("pnpm exec playwright install chromium");
  await expect(card).toContainText(
    "Installs the browser the e2e tests run in. Deny and the helper reports back without them.",
  );
  await expect(helperLine(page, "Check the e2e tests")).toContainText("Needs your OK");
  await expect(helperLine(page, "Review against standards")).toContainText("Done · 1 step");
  await shot(page, "helper-asks");

  await card.getByRole("button", { name: "Deny" }).click();

  const asked = helperLine(page, "Check the e2e tests");
  await expect(asked).toContainText("Done");
  await asked.getByRole("button").click();
  await expect(asked).toContainText(
    "Couldn't run pnpm exec playwright install chromium: The owner denied that command",
  );
  await expect(card).toHaveCount(0);
});

test("a helper that writes code shows its own branch, then Merged, and one that clashed says the session is sorting it (#395)", async ({
  page,
  request,
}) => {
  await openCoding(page, request, [
    "helper Build the API (own branch): edit file README.md: # The API | report: Built it.",
    "helper Build the sheet (own branch): pause 1500 | edit file README.md: # The sheet | report: Built it. It and the API helper both changed README.md.",
    "helper Write the e2e test (own branch): edit file e2e.spec.ts: test | hold",
    "helper Review against the spec: read file: docs/spec.md | report: Matches the spec.",
  ]);
  const api = helperLine(page, "Build the API");
  const sheet = helperLine(page, "Build the sheet");
  const e2e = helperLine(page, "Write the e2e test");
  const review = helperLine(page, "Review against the spec");

  for (const reloaded of [false, true]) {
    if (reloaded) await page.reload();
    await expect(api).toContainText("Merged");
    await expect(api).toContainText("Done · 1 step");
    await expect(sheet).toContainText("Own branch");
    await expect(sheet).toContainText("Didn't merge cleanly · the session is sorting it");
    await expect(e2e).toContainText("Own branch");
    await expect(e2e).toContainText("Edited e2e.spec.ts");
    // A helper sharing the session's folder has no tag.
    await expect(review).toContainText("Done · 1 step");
    await expect(review).not.toContainText(/Own branch|Merged/);
  }
  await sheet.getByRole("button").click();
  await expect(sheet).toContainText("It and the API helper both changed README.md.");
  await shot(page, "helpers-own-branch-fold");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(sheet).toContainText("Didn't merge cleanly");
  await shot(page, "helpers-own-branch-desktop");
});
