import { expect, test } from "@playwright/test";

// Matt Pocock's skills in every code workspace (#181), from the stand-in for his plugin that
// start-worker.mjs gives the worker. The setup check's offer is in github.spec.ts, whose tests sign
// in and out of the fake GitHub one at a time.

test("a code workspace's skill picker offers Matt Pocock's skills the owner starts, and only those", async ({
  page,
}) => {
  await page.goto("/workspaces/side-project");
  // Skills are off a code workspace's Home (#301): the rail's Skills sheet has them (#197).
  await expect(page.getByRole("region", { name: "Skills" })).toHaveCount(0);

  await page.getByRole("button", { name: "Skills" }).click();
  const picker = page.getByRole("dialog", { name: "Skills" });
  await expect(picker.getByRole("button", { name: /Implement/ })).toBeVisible();
  await expect(picker.getByRole("button", { name: /Tdd/ })).toHaveCount(0);
});
