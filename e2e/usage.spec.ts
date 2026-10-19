import { expect, type Page, test } from "@playwright/test";
import { chooseModel, chosen, modelSheet } from "./frame.ts";

// Usage at a glance (#66). Every spec shares one worker, so nothing here fills the fake's plan:
// the meters are the fake's own as it starts, and the warnings are the worker's answer as a test
// gives it (the worker's side is in apps/worker/test/usage.test.ts).

const inTwoDays = () => new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

/** The worker's usage with Fake's week at 82%, warning, and Fake two to switch to. */
const nearFakesLimit = () => ({
  providers: [
    {
      provider: "fake",
      label: "Fake",
      usage: {
        kind: "plan",
        meters: [
          { window: "five-hour", used: 40, resetAt: inTwoDays() },
          { window: "weekly", used: 82, resetAt: inTwoDays() },
        ],
        models: [],
        readAt: new Date().toISOString(),
      },
    },
    { provider: "fake-two", label: "Fake two", usage: { kind: "no-plan" } },
  ],
  warnings: [
    {
      provider: "fake",
      label: "Fake",
      window: "weekly",
      used: 82,
      resetAt: inTwoDays(),
      switchTo: { label: "Fake two", model: { provider: "fake-two", model: "echo" } },
    },
  ],
});

/** Answers the page's usage calls with Fake near its limit, until Not now; gives what Not now sent. */
const usageAnswers = async (page: Page) => {
  let usage = nearFakesLimit();
  const putOff: unknown[] = [];
  await page.route("**/api/usage**", async (route) => {
    if (route.request().method() === "POST") {
      putOff.push(route.request().postDataJSON());
      usage = { ...usage, warnings: [] };
    }
    await route.fulfill({ json: usage });
  });
  return putOff;
};

test("the Model sheet shows each provider's plan meters above its models, or that it has none", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");

  const sheet = await modelSheet(page);

  const fakes = sheet.getByRole("region", { name: "Fake's plan limits" });
  await expect(fakes).toContainText("5-hour");
  await expect(fakes).toContainText("This week");
  await expect(fakes).toContainText(/\d+%/);
  await expect(fakes).toContainText(/resets/);
  await expect(sheet).toContainText("No plan limits for this sign-in");
});

test("near a limit, a session warns above the Reply box: Switch sends the next message to the other provider, and Not now puts it off", async ({
  page,
}) => {
  const putOff = await usageAnswers(page);
  await page.goto("/workspaces/garage-gym#new");
  await chooseModel(page, "fake/echo");
  await page.getByLabel("Message", { exact: true }).fill("Which plates for the rack?");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "You said: Which plates for the rack?",
  );

  const warning = page.getByRole("region", { name: "Near a usage limit" });
  await expect(warning).toContainText("Fake: 82% of this week used");
  await expect(warning).toContainText(/Resets .* · switch before it stops mid-turn/);

  await warning.getByRole("button", { name: "Switch to Fake two" }).click();

  // The next message goes to Fake two, which has room: no warning for it.
  await expect(warning).toBeHidden();
  expect((await chosen(page)).model).toBe("fake-two/echo");
  await page.getByLabel("Message", { exact: true }).fill("And the bar?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "Now answering: Fake two",
  );

  // Back on Fake, it warns again until Not now.
  await chooseModel(page, "fake/echo");
  await expect(warning).toBeVisible();
  await warning.getByRole("button", { name: "Not now" }).click();
  await expect(warning).toBeHidden();
  expect(putOff).toEqual([{ provider: "fake" }]);
});

test("near a limit, a code workspace's Home has a gold usage line above Main, which opens the Model sheet", async ({
  page,
}) => {
  await usageAnswers(page);
  await page.goto("/workspaces/side-project");

  const line = page.getByRole("region", { name: "Usage" });
  await expect(line).toContainText("Fake: 82% of this week");
  await expect(line).toContainText(/resets/);
  // The frame, with its Model sheet, comes in after the page.
  await expect(page.getByRole("button", { name: /^Model: / })).toBeEnabled();

  await line.getByRole("button").click();

  // The quick switch first; the plans' meters are under More models (#247).
  const sheet = page.getByRole("dialog", { name: "Model" });
  await sheet.getByRole("button", { name: /^More models/ }).click();
  await expect(sheet.getByRole("region", { name: "Fake's plan limits" })).toContainText("82%");
});
