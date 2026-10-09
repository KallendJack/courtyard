import { expect, test } from "@playwright/test";

// Web search (ADR 0019): the fake acts out a search with the lines "search the web for: …",
// "read page: …" and "cite: [title](address)".

const SEARCHING = [
  "What do Titan's J-hooks cost?",
  "search the web for: Titan T-3 J-hooks price",
  "read page: https://titan.fitness/j-hooks",
  "cite: [T-3 Series J-Hooks | Titan Fitness](https://titan.fitness/j-hooks)",
  "cite: [Titan T-3 review](https://www.garagegymreviews.com/titan-t3)",
].join("\n");

test("what the model searched and read shows above the answer, and its numbered sources under it, after a reload too", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");
  await page.getByLabel("Message").fill(SEARCHING);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/workspaces\/garage-gym\/sessions\//);

  for (const reloaded of [false, true]) {
    if (reloaded) await page.reload();
    const activities = page.getByRole("list", { name: "What the model did" });
    await expect(activities.getByRole("listitem")).toHaveText([
      "Searched the web for “Titan T-3 J-hooks price”",
      "Read titan.fitness",
    ]);
    const sources = page.getByRole("list", { name: "Sources" });
    // Numbered, as an ordered list.
    await expect(sources).toHaveJSProperty("tagName", "OL");
    await expect(sources.getByRole("listitem")).toHaveText([
      "Titan Fitness · T-3 Series J-Hooks",
      "garagegymreviews.com · Titan T-3 review",
    ]);
    const first = sources.getByRole("link", { name: "Titan Fitness" });
    await expect(first).toHaveAttribute("href", "https://titan.fitness/j-hooks");
    await expect(first).toHaveAttribute("target", "_blank");
    // No site icons: nothing is loaded from the sites.
    await expect(sources.locator("img")).toHaveCount(0);
  }
});

test.describe("copying", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("Copy answer copies the sources too, as Markdown links", async ({ page }) => {
    await page.goto("/workspaces/garage-gym");
    await page.getByLabel("Message").fill(SEARCHING);
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("list", { name: "Sources" })).toBeVisible();

    await page.getByRole("button", { name: "Copy answer" }).click();

    const copied = (await page.evaluate(() => navigator.clipboard.readText())).replaceAll(
      "\r\n",
      "\n",
    );
    expect(copied).toBe(
      [
        `You said: ${SEARCHING}`,
        "",
        "Sources:",
        "1. [Titan Fitness](https://titan.fitness/j-hooks) · T-3 Series J-Hooks",
        "2. [garagegymreviews.com](https://www.garagegymreviews.com/titan-t3) · Titan T-3 review",
      ].join("\n"),
    );
  });
});

test("an answer that didn't use the web lists no sources", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");
  await page.getByLabel("Message").fill("Where should the rack go?");
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "You said: Where should the rack go?",
  );
  await expect(page.getByRole("list", { name: "Sources" })).toHaveCount(0);
});
