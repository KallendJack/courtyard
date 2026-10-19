import { expect, type Locator, type Page, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";

// Floor plans Courtyard draws itself (#257; Paper, "Tablet · Floor plan in an answer (#257)" and
// its Cover board): a `plan` block in an answer drawn top-down and to scale, front at the bottom,
// with what's in it listed beside it; saved straight away, so Home shows it too.

const GARAGE = {
  room: "Garage",
  width: 300,
  depth: 540,
  front: "Garage door",
  beyond: { left: "House" },
  openings: [
    { kind: "garage-door", wall: "front", at: 30, width: 240 },
    { kind: "door", wall: "right", at: 300, width: 80, name: "Side door" },
    { kind: "window", wall: "back", at: 100, width: 100 },
  ],
  partitions: [{ fromBack: 270, doorway: { at: 200, width: 80 } }],
  zones: [
    { name: "Office", fromLeft: 0, fromBack: 0, width: 300, depth: 270 },
    { name: "Workshop", fromLeft: 0, fromBack: 270, width: 300, depth: 270 },
  ],
  items: [
    {
      name: "Workbench",
      fromLeft: 0,
      fromBack: 300,
      width: 60,
      depth: 120,
      why: "On the house side, so bikes stand clear of the side door",
    },
    { name: "Desk", fromLeft: 80, fromBack: 0, width: 140, depth: 60 },
    { name: "Tool wall", wall: "left", at: 300, length: 120 },
    { name: "Turbo trainer", status: "want", fromLeft: 220, fromBack: 60, width: 60, depth: 180 },
  ],
};

const MESSAGE = `Here's the garage:\n\n\`\`\`plan\n${JSON.stringify(GARAGE)}\n\`\`\`\n\nThat's it.`;

/** Starts a session with the plan in its message, which the fake answers with, and waits for it. */
const drawn = async (page: Page, name: string) => {
  await newWorkspace(page, name);
  await startSaving(page, MESSAGE);
  await expect(page.getByRole("list", { name: "Session" })).toContainText(/Your turn · finished/);
  return page.getByRole("figure", { name: "Garage floor plan" }).first();
};

/** A rectangle's own box as drawn, without its outline's width. */
const boxOf = async (rect: Locator) => {
  const [x, y, width, height] = await Promise.all(
    ["x", "y", "width", "height"].map(async (name) => Number(await rect.getAttribute(name))),
  );
  return { x: x ?? 0, y: y ?? 0, width: width ?? 0, height: height ?? 0 };
};

test("a plan in an answer is drawn to scale, and tapping a thing on it shows its size and why", async ({
  page,
}) => {
  const plan = await drawn(page, `Plan ${Date.now()}`);

  // The room 3 m wide and 5.4 m deep, the workbench 60 cm of its width and 120 cm of its depth.
  const room = await boxOf(plan.locator('[data-plan-part="room"]'));
  expect(room.width / room.height).toBeCloseTo(300 / 540, 2);
  const bench = await boxOf(
    plan.getByRole("button", { name: "Workbench", exact: true }).locator("rect"),
  );
  expect(bench.width / room.width).toBeCloseTo(60 / 300, 2);
  expect(bench.height / room.height).toBeCloseTo(120 / 540, 2);
  // Below the room's middle, as it's nearer the front, which is at the bottom.
  expect(bench.y).toBeGreaterThan(room.y + room.height / 2);

  await expect(plan.locator('[data-plan-part="opening"]')).toHaveCount(3);
  await expect(plan.locator('[data-plan-part="partition"]')).toHaveCount(1);
  await expect(plan.locator('[data-plan-part="zone"]')).toHaveText(["Office", "Workshop"]);
  await expect(plan).toContainText("Front · Garage door");
  await expect(plan).toContainText("3.0 m");
  await expect(plan).toContainText("5.4 m");
  // What you want is drawn dashed, what you have solid.
  await expect(plan.getByRole("button", { name: "Turbo trainer", exact: true })).toHaveAttribute(
    "data-status",
    "want",
  );

  const list = plan.getByRole("list", { name: "What's in the garage" });
  await expect(list.getByRole("button", { name: /Workbench/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await plan.getByRole("button", { name: "Workbench", exact: true }).click();
  const chosen = list.getByRole("button", { name: /Workbench/ });
  await expect(chosen).toHaveAttribute("aria-pressed", "true");
  await expect(chosen).toContainText("120 × 60 cm");
  await expect(chosen).toContainText("On the house side, so bikes stand clear of the side door");
  await expect(plan.getByRole("button", { name: "Workbench", exact: true })).toHaveAttribute(
    "data-chosen",
    "",
  );
  await expect(list).toContainText("want · 180 × 60 cm");
});

test("a plan drawn in an answer is saved straight away, and shows on the workspace's Home", async ({
  page,
}) => {
  const name = `Saved plan ${Date.now()}`;
  const plan = await drawn(page, name);
  await expect(plan.getByText("On Home ✓")).toBeVisible();

  await page.getByRole("link", { name: `Back to ${name}` }).click();
  const onHome = page.getByRole("figure", { name: "Garage floor plan" });
  await expect(onHome).toBeVisible();
  await expect(onHome.getByText("On Home ✓")).toHaveCount(0);
  await onHome
    .getByRole("list", { name: "What's in the garage" })
    .getByRole("button", {
      name: /Desk/,
    })
    .click();
  await expect(onHome.getByRole("button", { name: "Desk", exact: true })).toHaveAttribute(
    "data-chosen",
    "",
  );
});
