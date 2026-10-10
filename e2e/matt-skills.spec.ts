import { expect, test } from "@playwright/test";

// Matt Pocock's skills in every code workspace (#181), from the stand-in for his plugin that
// start-worker.mjs gives the worker. The setup check's offer is in github.spec.ts, whose tests sign
// in and out of the fake GitHub one at a time.

test("a code workspace lists Matt Pocock's skills, and the picker only those the owner starts", async ({
  page,
}) => {
  await page.goto("/workspaces/side-project");
  const skills = page.getByRole("list", { name: "Skills" });
  await expect(skills.getByRole("listitem").filter({ hasText: "Implement" })).toContainText(
    "Matt Pocock's",
  );
  await expect(skills.getByRole("listitem").filter({ hasText: "Tdd" })).toContainText(
    "Matt Pocock's",
  );

  await page.getByLabel("Message").fill("/");
  const picker = page.getByRole("listbox");
  await expect(picker.getByRole("option", { name: /Implement/ })).toBeVisible();
  await expect(picker.getByRole("option", { name: /Tdd/ })).toHaveCount(0);
});
