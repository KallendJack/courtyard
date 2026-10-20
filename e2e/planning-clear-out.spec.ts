import { expect, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";

// The planning clear-out (#600, ADR 0032): what planning workspaces had and the owner didn't use is
// gone. No Step by step on an answer with numbered steps, no status line under a planning
// workspace's name (a code workspace keeps its own, built from its data), and no Blocked shops or
// Allowed commands in its ⋯.

test("an answer with numbered steps offers no Step by step", async ({ page, request }) => {
  // The fake echoes the message, so numbered lines make an answer with steps.
  const response = await request.post("/api/workspaces/garage-gym/sessions", {
    data: {
      text: "Fitting the pads:\n1. Take the wheel out.\n2. Slide the old pads out.\n3. Push the pistons back.",
      model: { provider: "fake", model: "echo" },
    },
  });
  expect(response.status()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  await page.goto(`/workspaces/garage-gym/sessions/${id}`);
  await expect(page.getByRole("button", { name: "Copy answer" })).toBeVisible();

  await expect(page.getByRole("button", { name: /^Step by step/ })).toHaveCount(0);
});

test("a planning workspace shows no status line, even after a session's turn", async ({ page }) => {
  const name = `Kit ${Date.now()}`;
  await newWorkspace(page, name);
  // Words the fake once moved a line along with.
  await startSaving(page, "Pump's here. just done: Shock pump; now: Lights; next: Shoes");
  await page.getByRole("link", { name: `Back to ${name}` }).click();

  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  // Loaded afresh, as a line moved along once the turn ended would have been.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("list", { name: "Status" })).toHaveCount(0);
});

test("a planning workspace's ⋯ has no Blocked shops or Allowed commands", async ({ page }) => {
  const name = `Menu ${Date.now()}`;
  await newWorkspace(page, name);

  await page.getByRole("button", { name: "Workspace options" }).click();
  const menu = page.getByRole("dialog", { name });
  await expect(menu.getByRole("button", { name: /^Rename/ })).toBeVisible();
  await expect(menu.getByRole("button", { name: /^Blocked shops/ })).toHaveCount(0);
  await expect(menu.getByRole("button", { name: /^Allowed commands/ })).toHaveCount(0);
});
