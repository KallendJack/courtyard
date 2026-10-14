import { expect, type Page } from "@playwright/test";

// The Handheld frame's ways in, on every screen since #197: the model and effort a message goes
// with are on the rail's Model sheet, not in the message box.

/** Opens the frame's Model sheet and gives it. */
export const modelSheet = async (page: Page) => {
  await page.getByRole("button", { name: /^Model: / }).click();
  const sheet = page.getByRole("dialog", { name: "Model" });
  await expect(sheet).toBeVisible();
  return sheet;
};

/** Picks a model on the Model sheet by its value ("fake/echo", "fake-two/echo"), and closes it. */
export const chooseModel = async (page: Page, value: string) => {
  const sheet = await modelSheet(page);
  await sheet.locator(`label:has(input[type="radio"][value="${value}"])`).click();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
};

/** Picks an effort on the Model sheet ("low", "medium", "high", or "" for the default), and closes it. */
export const chooseEffort = async (page: Page, level: string) => {
  const sheet = await modelSheet(page);
  await sheet
    .getByRole("radiogroup", { name: "Effort" })
    .locator(`label:has(input[type="radio"][value="${level}"])`)
    .click();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
};

/** What the Model sheet has chosen: the model's and the effort's values. */
export const chosen = async (page: Page) => {
  const sheet = await modelSheet(page);
  const value = (group: string) =>
    sheet
      .getByRole("radiogroup", { name: group })
      .locator('input[type="radio"]:checked')
      .evaluate((radio) => (radio as HTMLInputElement).value);
  const now = { model: await value("Model"), effort: await value("Effort") };
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  return now;
};
