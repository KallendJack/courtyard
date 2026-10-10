import { expect, type Page, test } from "@playwright/test";
import { standInPushService } from "./push-service.ts";

// Notifications (#173): each device turns its own on, beside Connections on the home page. The
// browser's push service is a stand-in (push-service.ts); the worker is real.

/** The worker's answer to the next time the page sends it this device's subscription, or turns it off. */
const workerHears = (page: Page, change: "on" | "off") =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/notifications/${change}`) &&
      response.request().method() === "POST",
  );

test("the owner turns notifications on for this device, and off again", async ({ page }) => {
  await standInPushService(page);
  await page.goto("/");
  const card = page.getByRole("region", { name: "Notifications" });
  const here = card.getByRole("switch", { name: "On this device" });
  await expect(card).toContainText("When a session needs your OK, or a turn finishes or fails.");
  await expect(card).toContainText(
    "Each device turns its own on. Only the title and what it needs show on a locked screen.",
  );
  await expect(here).toBeEnabled();
  await expect(here).not.toBeChecked();

  const on = workerHears(page, "on");
  await here.click();
  expect((await on).status()).toBe(204);
  await expect(here).toBeChecked();
  // Still on when the page opens again, and the worker told again, in case this device's login changed.
  const again = workerHears(page, "on");
  await page.reload();
  expect((await again).status()).toBe(204);
  await expect(here).toBeChecked();

  const off = workerHears(page, "off");
  await here.click();
  expect((await off).status()).toBe(204);
  await expect(here).not.toBeChecked();
  await page.reload();
  await expect(here).toBeEnabled();
  await expect(here).not.toBeChecked();
});
