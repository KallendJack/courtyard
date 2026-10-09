import { expect, type Page, test } from "@playwright/test";

// Suggested replies (ADR 0017): the fake suggests the replies a message scripts, one line
// "suggest replies: A | B".

/** Starts a session in garage-gym whose answer suggests `replies`, at `effort`. */
const startSuggesting = async (page: Page, replies: readonly string[], effort?: string) => {
  await page.goto("/workspaces/garage-gym");
  if (effort !== undefined) await page.getByLabel("Effort").selectOption({ label: effort });
  await page
    .getByLabel("Message")
    .fill(`Where should the rack go?\nsuggest replies: ${replies.join(" | ")}`);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/workspaces\/garage-gym\/sessions\//);
  return page.getByRole("list", { name: "Suggested replies" });
};

test("a suggested reply is sent with a tap, at the turn's effort, and the replies go", async ({
  page,
}) => {
  const suggested = await startSuggesting(page, ["Back wall", "By the door"], "High effort");
  await expect(suggested.getByRole("button")).toHaveText(["Back wall", "By the door"]);

  // They survive a reload.
  await page.reload();
  await suggested.getByRole("button", { name: "By the door" }).click();

  const session = page.getByRole("list", { name: "Session" });
  await expect(session).toContainText("You said: By the door");
  await expect(suggested).toBeHidden();
  await page.reload();
  await expect(page.getByLabel("Effort").locator("option:checked")).toHaveText("High effort");
  await expect(suggested).toBeHidden();
});

test("typing a reply of one's own takes the suggested ones away", async ({ page }) => {
  const suggested = await startSuggesting(page, ["Back wall", "By the door"]);
  await expect(suggested.getByRole("button")).toHaveCount(2);

  await page.getByLabel("Message").fill("Neither, the side wall.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "You said: Neither, the side wall.",
  );
  await expect(suggested).toBeHidden();
});

test("the replies sit in a row on a wide screen", async ({ page }) => {
  const suggested = await startSuggesting(page, ["Back wall", "By the door"]);
  const [first, second] = await Promise.all(
    ["Back wall", "By the door"].map((name) =>
      suggested.getByRole("button", { name }).boundingBox(),
    ),
  );
  expect(second?.y).toBe(first?.y);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the replies stack, one under another", async ({ page }) => {
    const suggested = await startSuggesting(page, ["Back wall", "By the door"]);
    await expect(suggested.getByRole("button")).toHaveCount(2);
    const [first, second] = await Promise.all(
      ["Back wall", "By the door"].map((name) =>
        suggested.getByRole("button", { name }).boundingBox(),
      ),
    );
    expect(second?.y ?? 0).toBeGreaterThan((first?.y ?? 0) + (first?.height ?? 0) - 1);
    expect(second?.x).toBe(first?.x);
  });
});
