import { expect, type Page } from "@playwright/test";

// The Handheld frame's ways in, on every screen since #197: the model and effort a message goes
// with are on the rail's Model sheet, not in the message box.

/**
 * Opens the frame's Model sheet and gives it, with every model and effort open under More models
 * (#247) unless `more` is false, which leaves it as it was: the quick switch, and More models shut
 * the first time.
 */
export const modelSheet = async (page: Page, options: { more?: boolean } = {}) => {
  await page.getByRole("button", { name: /^Model: / }).click();
  const sheet = page.getByRole("dialog", { name: "Model" });
  await expect(sheet).toBeVisible();
  const more = sheet.getByRole("button", { name: /^More models/ });
  if (options.more !== false && (await more.getAttribute("aria-expanded")) === "false") {
    await more.click();
  }
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

/** On the cover screen's frame (under 600 px wide), the message box opens with Type. */
export const openBox = async (page: Page) => {
  if ((page.viewportSize()?.width ?? 1280) < 600) {
    await page.getByRole("button", { name: "Type" }).click();
  }
};

/** The open workspace's recent sessions, on the sheet a right-click on its tile opens. */
export const openRecent = async (page: Page, workspace: string) => {
  await page
    .getByRole("navigation", { name: "Workspaces" })
    .getByRole("link", { name: workspace })
    .click({ button: "right" });
  return page.getByRole("region", { name: `Recent in ${workspace}` });
};
