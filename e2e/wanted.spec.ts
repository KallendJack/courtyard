import { expect, type Page, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";
import { fromWorkspaceMenu, openTab } from "./workspace-page.ts";

/** Starts a session with `message`, and waits for its answer to finish, so it's seen. */
const say = async (page: Page, message: string) => {
  await startSaving(page, message);
  await expect(page.getByRole("list", { name: "Session" })).toContainText(/Your turn · finished/);
};

// The wanted list (#245): the Things wanted or to replace on the Things tab, each with its ★
// pick's price and its shop's one button; Find picks, run by the fake as a short background turn;
// a product in an answer added with one tap; and the shops the owner blocked, in the ⋯ menu.

test("Find picks finds a wanted Thing's three picks, and tapping it shows them, each with its shop", async ({
  page,
}) => {
  const name = `Lights ${Date.now()}`;
  await newWorkspace(page, name);
  await say(page, "thing add: name Lights | status want");
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await openTab(page, "Things");

  const wanted = page.getByRole("region", { name: "Wanted" });
  const lights = wanted.getByRole("listitem").filter({ hasText: "Lights" });
  await expect(lights).toContainText("To get · no picks yet");
  await lights.getByRole("button", { name: "Find picks" }).click();

  // The fake picks from Tredz first, £55 in the sale from £72.
  await expect(lights).toContainText("★ £55");
  await expect(lights).toContainText("To get · in the sale, usually £72");
  await expect(lights.getByRole("link", { name: "Tredz" })).toHaveAttribute(
    "href",
    "https://tredz.example/lights",
  );
  await expect(wanted).toContainText("★ picks so far · £55 · checked today");

  await lights.getByRole("button", { name: /Lights/ }).click();
  const picks = wanted.getByRole("list", { name: "Picks for Lights" });
  await expect(picks.getByRole("listitem")).toHaveText([
    /★ Best value.*Lights, best value.*Does the job well for the money · in the sale, was £72.*£55.*today.*Tredz/,
    /Cheapest that does the job.*Lights, cheapest.*£38.*Halfords/,
    /Worth stretching for.*Lights, worth stretching for.*£150.*Wiggle/,
  ]);
  await expect(wanted.getByRole("button", { name: /^1 ?Lights/ })).toContainText(
    "3 picks · prices checked today",
  );
});

test("a product named in an answer is added to the wanted list with one tap", async ({ page }) => {
  const name = `Back wall ${Date.now()}`;
  await newWorkspace(page, name);
  await say(
    page,
    'Two kinds fit:\n\n```product\n{"name": "Wall track", "about": "about £140 · moves as the garage changes"}\n```\n\nThat\'s all.',
  );

  const product = page.getByLabel("Wall track", { exact: true });
  await expect(product).toContainText("about £140 · moves as the garage changes");
  await product.getByRole("button", { name: "Add to wanted" }).click();
  await expect(product).toContainText("In Wanted");
  await expect(product.getByRole("button", { name: "Add to wanted" })).toHaveCount(0);

  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await openTab(page, "Things");
  await expect(
    page
      .getByRole("region", { name: "Wanted" })
      .getByRole("listitem")
      .filter({ hasText: "Wall track" }),
  ).toContainText("To get · no picks yet");
});

test("a shop the owner said not to use is listed in Blocked shops, and Unblock lets it back", async ({
  page,
}) => {
  const name = `Shops ${Date.now()}`;
  await newWorkspace(page, name);
  await say(page, "block shop: Tredz | not from Tredz");
  await page.getByRole("link", { name: `Back to ${name}` }).click();

  await fromWorkspaceMenu(page, name, "Blocked shops");
  const sheet = page.getByRole("dialog", { name: `Blocked shops · ${name}` });
  const tredz = sheet.getByRole("listitem").filter({ hasText: "Tredz" });
  await expect(tredz).toContainText('you said "not from Tredz"');

  await tredz.getByRole("button", { name: "Unblock Tredz" }).click();
  await expect(sheet.getByRole("listitem")).toHaveCount(0);
  await expect(sheet).toContainText("None yet.");
});
