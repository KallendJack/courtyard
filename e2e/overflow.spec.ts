import { expect, test } from "@playwright/test";

// Overflow, on the two fakes: "Fake two" acts out a usage limit, and the session carries on with
// "Fake". Only Fake two is ever sent to its limit, so the other tests' sessions (on Fake) are
// never affected.

test("after a usage limit, Carry on answers with the other provider and a line marks the change", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");
  // By its value: once Fake two is at its limit (on a retry, say), its label says so.
  await page.getByLabel("Model").selectOption("fake-two/echo");
  await page.getByLabel("Message").fill("please hit Fake two's limit");
  await page.getByRole("button", { name: "Start" }).click();

  const notice = page.getByRole("alert").filter({ hasText: "Fake two's usage limit is reached" });
  await expect(notice).toContainText(/It resets (today|tomorrow) at/);
  // The picker labels the model at its limit, and still offers it.
  await expect(page.getByLabel("Model").locator("option", { hasText: "Fake two" })).toHaveText(
    /^Fake two \(echoes you\) · limit reached, resets/,
  );

  await notice.getByRole("button", { name: "Carry on with Fake" }).click();

  const session = page.getByRole("list", { name: "Session" });
  await expect(session).toContainText("Now answering: Fake (echoes you), default effort");
  await expect(session).toContainText("You said: please hit Fake two's limit");
  // The limit stays shown on the failed turn, with nothing left to carry on.
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("button")).toHaveCount(0);
  // The session stays on the model it carried on with.
  await expect(page.getByLabel("Model").locator("option:checked")).toHaveText("Fake (echoes you)");
});
