import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";

/** Where the PR's screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (part: Locator, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await part.screenshot({ path: join(folder, `${name}.png`) });
};

// Floor plans Courtyard draws itself (#257; Paper, "Tablet · Floor plan in an answer (#257)" and
// its Cover board): a `plan` block in an answer drawn top-down and to scale, front at the bottom,
// with what's in it listed beside it; saved straight away, so Home shows it too.

const GARAGE = {
  room: "Garage",
  width: 300,
  depth: 540,
  measured: true,
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

/**
 * A whole floor drawn from its rooms' sizes (#661): its outline wasn't measured, and some things
 * on it have no size anyone gave, so they're placed by where they are and nothing more.
 */
const GROUND_FLOOR = {
  room: "Ground floor",
  width: 700,
  depth: 784,
  zones: [
    { name: "Kitchen", fromLeft: 191, fromBack: 0, width: 269, depth: 252 },
    { name: "Garage", fromLeft: 0, fromBack: 270, width: 274, depth: 514 },
  ],
  items: [
    { name: "Boiler", wall: "left", at: 280 },
    { name: "Fridge freezer", fromLeft: 214, fromBack: 270, width: 60, depth: 61 },
    { name: "Projecting wall", fromLeft: 261, fromBack: 724, width: 13 },
  ],
};

const messageWith = (plan: { room: string }) =>
  `Here's the ${plan.room.toLowerCase()}:\n\n\`\`\`plan\n${JSON.stringify(plan)}\n\`\`\`\n\nThat's it.`;

/** Starts a session with the plan in its message, which the fake answers with, and waits for it. */
const drawn = async (page: Page, name: string, plan: { room: string } = GARAGE) => {
  await newWorkspace(page, name);
  await startSaving(page, messageWith(plan));
  await expect(page.getByRole("list", { name: "Session" })).toContainText(/Your turn · finished/);
  return page.getByRole("figure", { name: `${plan.room} floor plan` }).first();
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
  await shot(plan, "measured-plan");
});

test("a thing with no size given is a dot where it is, listed without one, and an outline nobody measured shows no size (#661)", async ({
  page,
}) => {
  const plan = await drawn(page, `Unmeasured ${Date.now()}`, GROUND_FLOOR);

  // Drawn to scale from its rooms, but with no overall size written anywhere.
  const room = await boxOf(plan.locator('[data-plan-part="room"]'));
  expect(room.width / room.height).toBeCloseTo(700 / 784, 2);
  await expect(plan).toContainText("Plan · Ground floor");
  await expect(plan).not.toContainText(/\d\.\d m/);

  // The boiler 280 cm down the left wall, as a dot by it: no strip, no length.
  const drawing = plan.getByRole("group", { name: "Ground floor, seen from the front" });
  const boiler = drawing.getByRole("button", { name: "Boiler", exact: true });
  await expect(boiler.locator("rect")).toHaveCount(0);
  const dot = boiler.locator("circle");
  const [cx, cy] = await Promise.all(
    ["cx", "cy"].map(async (name) => Number(await dot.getAttribute(name))),
  );
  expect(cx).toBeLessThan(room.x + 12);
  expect(((cy ?? 0) - room.y) / room.height).toBeCloseTo(280 / 784, 1);
  await expect(
    plan.getByRole("button", { name: "Projecting wall", exact: true }).locator("circle"),
  ).toHaveCount(1);

  const list = plan.getByRole("list", { name: "What's in the ground floor" });
  await expect(list.getByRole("button", { name: /Boiler/ })).not.toContainText("cm");
  await expect(list.getByRole("button", { name: /Projecting wall/ })).toContainText("13 cm wide");
  await expect(list.getByRole("button", { name: /Fridge freezer/ })).toContainText("61 × 60 cm");
  await boiler.click();
  await shot(plan, "unmeasured-plan");
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
