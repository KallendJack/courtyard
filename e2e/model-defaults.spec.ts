import { expect, type Locator, test } from "@playwright/test";
import { chosen, modelSheet } from "./frame.ts";

// A default model and effort for each provider (#247), and the Model sheet's quick switch: one
// chip per provider, its default. Only Fake two's default is changed here, and put back, since a
// new session starts on Fake's.

const quickSwitch = (sheet: Locator) => sheet.getByRole("group", { name: "Quick switch" });

test("a new session starts on the first provider's default, model and effort", async ({ page }) => {
  const level = (id: string, label: string) => ({ id, label });
  const efforts = [level("low", "Low"), level("medium", "Medium"), level("high", "High")];
  const capabilities = {
    readsFiles: true,
    codes: true,
    usesTools: true,
    savesContext: true,
    searchesWeb: true,
    steers: true,
  };
  await page.route("**/api/providers", (route) =>
    route.fulfill({
      json: {
        providers: [
          {
            id: "claude",
            label: "Claude",
            available: true,
            capabilities,
            models: [
              { id: "default", label: "Claude · Opus 5.5", name: "Opus 5.5", efforts },
              { id: "sonnet", label: "Claude · Sonnet 5.5", name: "Sonnet 5.5", efforts },
            ],
            default: { model: "default", effort: "high" },
          },
        ],
      },
    }),
  );
  await page.goto("/workspaces/garage-gym");

  await expect(page.getByRole("button", { name: "Model: Opus 5.5" })).toBeVisible();
  expect(await chosen(page)).toEqual({ model: "claude/default", effort: "high" });
  const sheet = await modelSheet(page, { more: false });
  await expect(quickSwitch(sheet).getByRole("button", { name: /^Claude/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(quickSwitch(sheet)).toContainText("Opus 5.5 · High");
});

test("the other provider's chip sends the next message to its default", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");
  const sheet = await modelSheet(page, { more: false });
  const chips = quickSwitch(sheet).getByRole("button");
  await expect(chips).toHaveCount(2);
  await expect(chips.first()).toHaveAttribute("aria-pressed", "true");

  await quickSwitch(sheet)
    .getByRole("button", { name: /^Fake two/ })
    .click();

  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: "Model: Fake two" })).toBeVisible();
  await page.getByLabel("Message", { exact: true }).fill("Which bar for the rack?");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "You said: Which bar for the rack?",
  );
  await page.reload();
  expect((await chosen(page)).model).toBe("fake-two/echo");
});

test.describe("Make this the default", () => {
  test.afterEach(async ({ page }) => {
    // Back to Fake two's own, for the other tests.
    const put = await page.request.put("/api/providers/fake-two/default", {
      data: { model: "echo" },
    });
    expect(put.ok()).toBe(true);
  });

  test("saves the shown model and effort as its provider's default, for the next new session", async ({
    page,
  }) => {
    await page.goto("/workspaces/garage-gym");
    const sheet = await modelSheet(page);
    await sheet.locator('label:has(input[type="radio"][value="fake-two/echo"])').click();
    await sheet
      .getByRole("radiogroup", { name: "Effort" })
      .locator('label:has(input[type="radio"][value="low"])')
      .click();

    const make = sheet.getByRole("button", { name: /^Make this the default/ });
    await expect(make).toContainText("Fake two starts on Fake two · Low from now on");
    await make.click();

    // It's the default now: its chip says so and is lit, and the line has gone.
    await expect(quickSwitch(sheet).getByRole("button", { name: /^Fake two/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(quickSwitch(sheet)).toContainText("Fake two · Low");
    await expect(make).toHaveCount(0);
    await page.keyboard.press("Escape");

    // A new session's page, loaded afresh: its Fake two chip goes to Low.
    await page.goto("/workspaces/garage-gym");
    const again = await modelSheet(page, { more: false });
    await quickSwitch(again)
      .getByRole("button", { name: /^Fake two/ })
      .click();
    expect(await chosen(page)).toEqual({ model: "fake-two/echo", effort: "low" });
  });
});
