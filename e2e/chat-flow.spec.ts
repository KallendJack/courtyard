import { expect, type Page, test } from "@playwright/test";
import { READING_SESSION_ID } from "./long-session.ts";

// A session's flow: whose turn it is (#179), messages queued while a turn runs (#177), and
// scrolling that never moves the owner away from where they are (#168).

/** Words enough that the fake model takes a few seconds to write them. */
const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i + 1}`).join(" ");

/** Starts a session in Garage gym with `text` as its first message, and waits for its page. */
const startSession = async (page: Page, text: string) => {
  await page.goto("/workspaces/garage-gym");
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/workspaces\/garage-gym\/sessions\//);
};

const sessionOn = (page: Page) => page.getByRole("list", { name: "Session" });

test.describe("whose turn it is", () => {
  test("a Working line says what the model is doing and for how long, then Your turn marks the end", async ({
    page,
  }) => {
    await startSession(page, `please read, then ${words(60)}`);
    const session = sessionOn(page);

    const working = session.getByText("Working", { exact: true });
    await expect(working).toBeVisible();
    // What it's doing, then how long the turn has taken so far.
    await expect(session).toContainText(/writing the answer0:0\d/);

    await expect(session).toContainText(/Your turn · finished \d\d:\d\d/);
    await expect(working).toHaveCount(0);
  });

  test("a stopped turn is marked as stopped, and the owner's turn", async ({ page }) => {
    await startSession(page, words(200));
    await expect(sessionOn(page).getByText("Working", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Stop" }).click();

    await expect(sessionOn(page)).toContainText(/Your turn · stopped \d\d:\d\d/);
  });

  test("the workspace's sessions say which is working and which is the owner's turn", async ({
    page,
  }) => {
    await startSession(page, `The finished one ${words(3)}`);
    await expect(sessionOn(page)).toContainText("Your turn · finished");
    await startSession(page, `The working one ${words(300)}`);
    await expect(sessionOn(page)).toContainText("writing the answer");

    await page.goto("/workspaces/garage-gym");
    const sessions = page.getByRole("region", { name: "Sessions" });
    const working = sessions.getByRole("link", { name: /The working one/i });
    await expect(working).toContainText("Working");
    await expect(working).toContainText(/writing the answer · \d+:\d\d/);
    // A model titles a session once its first answer is in (the fake, from its first words).
    await expect(sessions.getByRole("link", { name: /The finished one/i })).toContainText(
      "Your turn",
    );
    // The sidebar's recent sessions mark the one working with a dot.
    await expect(
      page
        .getByRole("region", { name: "Recent in Garage gym" })
        .getByRole("link", { name: /The working one/i })
        .getByRole("img", { name: "Working" }),
    ).toBeVisible();

    // It's asked again while one works, so the list says when that one ends.
    await expect(working).toContainText("Your turn", { timeout: 45_000 });
  });
});

test.describe("messages sent while a turn runs", () => {
  test("queue under the Working line, can be removed, and go in order once the turn ends", async ({
    page,
    context,
  }) => {
    await startSession(page, words(150));
    const session = sessionOn(page);
    await expect(session.getByText("Working", { exact: true })).toBeVisible();

    const message = page.getByRole("textbox", { name: "Message" });
    await expect(message).toHaveAttribute("placeholder", "Queue a message…");
    await message.fill("Also check the cover screen in light mode");
    await page.getByRole("button", { name: "Send" }).click();
    await message.fill("and write the PR the repo's way");
    await message.press("Enter");

    const queued = page.getByRole("list", { name: "Queued messages" });
    await expect(queued.getByRole("listitem")).toHaveText([
      /Also check the cover screen in light mode.*Queued · sends when this turn ends/,
      /and write the PR the repo's way.*Queued · 2nd/,
    ]);
    // Stop is still there while it answers.
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();

    // The same session on another device shows the queue, and removing one there removes it here.
    const other = await context.newPage();
    await other.goto(page.url());
    const queuedThere = other.getByRole("list", { name: "Queued messages" });
    await expect(queuedThere.getByRole("listitem")).toHaveCount(2);
    await queuedThere
      .getByRole("listitem")
      .first()
      .getByRole("button", { name: "Remove queued message" })
      .click();
    await expect(queued.getByRole("listitem")).toHaveText([
      /and write the PR the repo's way.*Queued · sends when this turn ends/,
    ]);

    await expect(session).toContainText("You said: and write the PR the repo's way", {
      timeout: 45_000,
    });
    await expect(queued).toHaveCount(0);
    await expect(session).not.toContainText("You said: Also check the cover screen");
  });
});

/** The Fold's cover screen, folded, in CSS pixels. */
const COVER_SCREEN = { width: 400, height: 640 };

const READING_SESSION = `/workspaces/garage-gym/sessions/${READING_SESSION_ID}`;

/** An answer many lines long, so it grows well past the bottom of the screen as it streams. */
const manyLines = (count: number) =>
  Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n");

/** How far the bottom of the screen is from the end of the page, in pixels. */
const fromTheEnd = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollHeight - (window.innerHeight + window.scrollY),
  );

/** Scrolls back up to read, as the owner does with a finger or a wheel. */
const readBack = async (page: Page) => {
  await page.mouse.move(200, 300);
  await page.mouse.wheel(0, -900);
  await expect.poll(() => fromTheEnd(page)).toBeGreaterThan(400);
};

/**
 * Where the owner is reading: the first turn on screen (perhaps begun above it), by its place in
 * the session, and how far down the screen its top is.
 */
const readingAt = (page: Page) =>
  page.evaluate(() => {
    const turns = [...document.querySelectorAll<HTMLElement>('[aria-label="Session"] > li')];
    const seen = turns.find((turn) => turn.getBoundingClientRect().bottom > 0);
    if (seen === undefined) throw new Error("no turn on screen");
    return { index: seen.dataset.index ?? "", top: Math.round(seen.getBoundingClientRect().top) };
  });

/** Where that same turn's top is on screen now. */
const topNow = (page: Page, index: string) =>
  page.evaluate((at) => {
    const turn = document.querySelector(`[aria-label="Session"] > li[data-index="${at}"]`);
    return turn === null ? undefined : Math.round(turn.getBoundingClientRect().top);
  }, index);

/** Two frames, so anything a change moves has moved. */
const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

/** Expects the owner to be reading just where they were: that turn's top where it was on screen. */
const stillAt = async (page: Page, reading: { index: string; top: number }) => {
  await frames(page);
  expect(await topNow(page, reading.index)).toBe(reading.top);
};

test.describe("reading back while it answers", () => {
  test.use({ viewport: COVER_SCREEN });

  test("new text never moves the owner, and Jump to latest, live while it answers, brings them down", async ({
    page,
  }) => {
    await page.goto(READING_SESSION);
    await page.getByRole("textbox", { name: "Message" }).fill(manyLines(80));
    await page.getByRole("button", { name: "Send" }).click();
    const session = sessionOn(page);
    await expect(session).toContainText("line 10");

    await readBack(page);
    const jump = page.getByRole("button", { name: /Jump to latest/ });
    await expect(jump).toHaveText("Jump to latest · still answering");
    const reading = await readingAt(page);
    await expect(session).toContainText("line 40");
    await stillAt(page, reading);

    await jump.click();
    await expect.poll(() => fromTheEnd(page)).toBeLessThan(2);
    await expect(jump).toBeHidden();
    // Following again: the end stays in view as the rest arrives.
    await expect(session).toContainText(/Your turn · finished/, { timeout: 45_000 });
    await expect.poll(() => fromTheEnd(page)).toBeLessThan(2);

    await readBack(page);
    await expect(jump).toHaveText("Jump to latest");
  });

  test("the keyboard opening or closing doesn't move the page", async ({ page }) => {
    await page.goto(READING_SESSION);
    await expect(sessionOn(page)).toContainText("You said:");
    await expect.poll(() => fromTheEnd(page)).toBeLessThan(2);

    // At the end, the end stays in view above the message box as the keyboard takes its room.
    await page.setViewportSize({ width: 400, height: 360 });
    await expect.poll(() => fromTheEnd(page)).toBeLessThan(2);
    await page.setViewportSize(COVER_SCREEN);
    await expect.poll(() => fromTheEnd(page)).toBeLessThan(2);

    // Reading back, what's on screen stays where it is.
    await readBack(page);
    const reading = await readingAt(page);
    await page.setViewportSize({ width: 400, height: 360 });
    await stillAt(page, reading);
    await page.setViewportSize(COVER_SCREEN);
    await stillAt(page, reading);
    await expect(page.getByRole("button", { name: /Jump to latest/ })).toBeVisible();
  });
});

test.describe("the chat never jumps back to the top", () => {
  test.use({ viewport: COVER_SCREEN });

  test("when a turn ends and a model titles the session", async ({ page }) => {
    await startSession(page, `reading back while it ends\n${manyLines(80)}`);
    const session = sessionOn(page);
    await expect(session).toContainText("line 20");
    await readBack(page);
    const reading = await readingAt(page);

    await expect(session).toContainText(/Your turn · finished/, { timeout: 45_000 });
    // The fake titles it from its first words, once its first answer is in.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Reading Back/);
    await stillAt(page, reading);
  });

  test("when the worker comes back after being away", async ({ page }) => {
    await page.goto(READING_SESSION);
    await expect(sessionOn(page)).toContainText("You said:");
    await readBack(page);
    const reading = await readingAt(page);

    await page.route("**/api/health", (route) => route.abort());
    const away = page.getByText("Can't reach Courtyard's worker. Retrying…");
    await expect(away).toBeVisible({ timeout: 15_000 });
    await page.unroute("**/api/health");
    await expect(away).toBeHidden({ timeout: 15_000 });

    await stillAt(page, reading);
  });

  test("when another device sends a message, and an approval card comes and goes", async ({
    page,
    context,
  }) => {
    await page.goto("/workspaces/side-project");
    await page.getByLabel("Model").selectOption("fake/echo");
    await page.getByRole("textbox", { name: "Message" }).fill(manyLines(60));
    await page.getByRole("button", { name: "Start" }).click();
    const session = sessionOn(page);
    await expect(session).toContainText(/Your turn · finished/, { timeout: 45_000 });
    await readBack(page);
    const reading = await readingAt(page);

    const other = await context.newPage();
    await other.goto(page.url());
    await other.getByRole("textbox", { name: "Message" }).fill("run command: rm -rf node_modules");
    await other.getByRole("button", { name: "Send" }).click();
    const card = page.getByRole("region", { name: "Needs your OK" });
    await expect(card).toBeAttached();
    await stillAt(page, reading);

    await other
      .getByRole("region", { name: "Needs your OK" })
      .getByRole("button", { name: "Deny" })
      .click();
    await expect(card).toHaveCount(0);
    await expect(session).toContainText(/Your turn · finished/);
    await stillAt(page, reading);
  });
});
