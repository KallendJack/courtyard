import { expect, type Page, test } from "@playwright/test";
import { newWorkspace } from "./saving.ts";

// Notify me (#493; Paper, "Notify me"): from a workspace's ⋯, what its notifications tell the
// owner of, Everything, Only what needs me or Nothing. A planning workspace starts on Only what
// needs me; a tap keeps the pick, and the worker decides what to send from it.

/** Opens a workspace's Notify me from its ⋯, and gives the sheet. */
const openNotifyMe = async (page: Page, name: string) => {
  await page.getByRole("button", { name: "Workspace options" }).click();
  await page
    .getByRole("dialog", { name })
    .getByRole("button", { name: /^Notify me/ })
    .click();
  const sheet = page.getByRole("dialog", { name: `Notify me · ${name}` });
  await expect(sheet).toBeVisible();
  return sheet;
};

test("a planning workspace starts on Only what needs me, and a tap on Nothing is kept", async ({
  page,
}) => {
  const name = `Notify ${Date.now()}`;
  await newWorkspace(page, name);

  const sheet = await openNotifyMe(page, name);
  await expect(sheet.getByRole("radio")).toHaveCount(3);
  await expect(sheet.getByRole("radio", { name: /^Only what needs me/ })).toBeChecked();
  await expect(sheet).toContainText("It still shows in Needs you on Home");
  // It rises from the bottom of the screen.
  const box = await sheet.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && Math.round(box.y + box.height)).toBe(viewport?.height);

  await sheet.getByText("Nothing", { exact: true }).click();
  await expect(sheet).toBeHidden();

  await page.reload();
  const again = await openNotifyMe(page, name);
  await expect(again.getByRole("radio", { name: /^Nothing/ })).toBeChecked();
});
