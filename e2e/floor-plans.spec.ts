import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";
import { shiftsOn } from "./shifts.ts";

/** Where the screenshots go, a whole page or one part of it, when a run asks (COURTYARD_E2E_SHOTS). */
const shot = async (part: Page | Locator, name: string) => {
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

/**
 * A house's ground floor from a developer's room table (#668): each room's size is known, so it's
 * written under its name; the floor's own outline is added up from them, so it isn't.
 */
const HOUSE_GROUND = {
  room: "Ground floor",
  width: 700,
  depth: 784,
  zones: [
    { name: "Kitchen", fromLeft: 191, fromBack: 0, width: 269, depth: 252 },
    { name: "Lounge", fromLeft: 393, fromBack: 338, width: 307, depth: 446 },
    { name: "Garage", fromLeft: 0, fromBack: 270, width: 274, depth: 514 },
    { name: "WC", fromLeft: 0, fromBack: 153, width: 170, depth: 90 },
  ],
  items: [{ name: "Fridge freezer", fromLeft: 214, fromBack: 270, width: 60, depth: 61 }],
};

test("each room on a plan shows its size under its name, a room too small for it in the list, and a floor added up from rooms none of its own (#668)", async ({
  page,
}) => {
  const plan = await drawn(page, `Rooms ${Date.now()}`, HOUSE_GROUND);

  // Under each name, width × depth in metres; the WC is too small on the plan for both lines.
  await expect(plan.locator('[data-plan-part="zone"]')).toHaveText([
    "Kitchen",
    "Lounge",
    "Garage",
    "WC",
  ]);
  await expect(plan.locator('[data-plan-part="zone-size"]')).toHaveText([
    "2.69 × 2.52",
    "3.07 × 4.46",
    "2.74 × 5.14",
  ]);
  const lounge = await plan.getByText("Lounge", { exact: true }).boundingBox();
  const size = await plan.getByText("3.07 × 4.46", { exact: true }).boundingBox();
  const middle = (box: typeof size) => (box?.y ?? 0) + (box?.height ?? 0) / 2;
  expect(middle(size) - middle(lounge)).toBeGreaterThan(8);
  expect(
    Math.abs((size?.x ?? 0) + (size?.width ?? 0) / 2 - (lounge?.x ?? 0) - (lounge?.width ?? 0) / 2),
  ).toBeLessThan(1);

  const rooms = plan.getByRole("list", { name: "Rooms in the ground floor" });
  await expect(rooms.getByRole("listitem")).toHaveText(["WC1.70 × 0.90"]);

  // The floor's outline was added up from its rooms: no overall size.
  await expect(plan).toContainText("Plan · Ground floor");
  await expect(plan).not.toContainText(/\d\.\d m/);
  await shot(plan, "room-sizes");
});

/** Bedroom 3 as the Office, at its size in the developer's room table: a known size (#668). */
const OFFICE = {
  room: "Office",
  width: 272,
  depth: 329,
  measured: true,
  items: [{ name: "Desk", fromLeft: 60, fromBack: 0, width: 140, depth: 60 }],
};

test("a one-room plan at a developer's size shows its overall size (#668)", async ({ page }) => {
  const plan = await drawn(page, `Developer size ${Date.now()}`, OFFICE);
  await expect(plan).toContainText("Plan · Office · 3.3 × 2.7 m");
  await expect(
    plan.getByRole("group", { name: /^Office, 2\.7 m wide and 3\.3 m deep/ }),
  ).toBeVisible();
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

// A garage shaped like a real one (#662): long and narrow, its garage door on the front wall,
// three things in it. On Home, under it, its projects.
const LONG_GARAGE = {
  room: "Garage",
  width: 274,
  depth: 514,
  front: "Garage door",
  beyond: { right: "House" },
  openings: [{ kind: "garage-door", wall: "front", at: 30, width: 213 }],
  items: [
    {
      name: "Projecting wall",
      why: "Narrows the width; its length is a stand-in",
      fromLeft: 261,
      fromBack: 454,
      width: 13,
      depth: 60,
    },
    { name: "Boiler", why: "Back corner on the outer wall", wall: "left", at: 0, length: 50 },
    { name: "Fridge freezer", fromLeft: 214, fromBack: 0, width: 60, depth: 61 },
  ],
};

const project = (name: string, step: string) =>
  `project: ${JSON.stringify({ name, add_steps: [{ kind: "you can do this", text: step }] })}`;

type Edges = { left: number; top: number; right: number; bottom: number };

const edgesOf = async (locator: Locator): Promise<Edges> => {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const { x, y, width, height } = box ?? { x: 0, y: 0, width: 0, height: 0 };
  return { left: x, top: y, right: x + width, bottom: y + height };
};

const expectInside = (inner: Edges, outer: Edges, what: string) => {
  expect(inner.left, `${what}'s left`).toBeGreaterThanOrEqual(outer.left - 1);
  expect(inner.top, `${what}'s top`).toBeGreaterThanOrEqual(outer.top - 1);
  expect(inner.right, `${what}'s right`).toBeLessThanOrEqual(outer.right + 1);
  expect(inner.bottom, `${what}'s foot`).toBeLessThanOrEqual(outer.bottom + 1);
};

const apart = (a: Edges, b: Edges) =>
  a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1;

// The owner's Fold, its browser's bars in (950×662) and not (950×712), and its cover screen: the
// plan is drawn whole inside its block, as big as the block lets it be, and no block runs over
// another (#662).
for (const viewport of [
  { width: 950, height: 662 },
  { width: 950, height: 712 },
  { width: 400, height: 900 },
]) {
  test.describe(`on Home at ${viewport.width}×${viewport.height}`, () => {
    test.use({ hasTouch: true, isMobile: true, viewport });

    test("a long garage's plan is drawn whole inside its block, its garage door in sight", async ({
      page,
    }) => {
      const name = `Long garage ${Date.now()}`;
      await newWorkspace(page, name);
      // On the cover screen the box opens with Type.
      if (viewport.width < 600) await page.getByRole("button", { name: "Type" }).tap();
      await startSaving(
        page,
        [
          `Here's the garage:\n\n\`\`\`plan\n${JSON.stringify(LONG_GARAGE)}\n\`\`\`\n`,
          project("Turn the garage into an office", "Measure the projecting wall"),
          project("Move the fridge freezer", "Find where the socket is"),
        ].join("\n"),
      );
      await expect(page.getByRole("list", { name: "Session" })).toContainText(
        /Your turn · finished/,
      );
      await page.getByRole("link", { name: `Back to ${name}` }).click();

      const plan = page.getByRole("figure", { name: "Garage floor plan" });
      await expect(plan).toBeVisible();
      const projects = page.getByRole("region", { name: "Projects" });
      await expect(projects.getByRole("listitem")).toHaveCount(2);

      // The plan's block: the figure is in its rich block, in Home's block.
      const block = await edgesOf(plan.locator("xpath=../.."));
      const drawing = await edgesOf(plan.getByRole("group", { name: /^Garage, / }));
      expectInside(drawing, block, "The drawing");
      // From a tablet up the long garage is turned to fit (#669): its length across the block, the
      // garage door on the left, the house along the bottom. The cover screen keeps it upright.
      const tablet = viewport.width >= 600;
      const roomEdges = await edgesOf(plan.locator('[data-plan-part="room"]'));
      // Its words too, which the drawing would cut off at its edge.
      const front = await edgesOf(plan.getByText(`${tablet ? "▶" : "▲"} Front · Garage door`));
      expectInside(front, drawing, "The front");
      const house = await edgesOf(plan.getByText("House", { exact: true }));
      expectInside(house, drawing, "House");
      if (tablet) {
        expect(front.right, "the front on the left").toBeLessThanOrEqual(roomEdges.left + 1);
        expect(house.top, "the house along the bottom").toBeGreaterThanOrEqual(
          roomEdges.bottom - 1,
        );
      }
      expectInside(
        await edgesOf(plan.locator('[data-plan-part="opening"]')),
        block,
        "The garage door",
      );
      const list = plan.getByRole("list", { name: "What's in the garage" });
      await expect(list.getByRole("button")).toHaveCount(3);
      // What's listed scrolls inside the block, so its box is inside the block's.
      expectInside(await edgesOf(list.locator("xpath=..")), block, "The list");
      // Drawn to scale still.
      const room = await boxOf(plan.locator('[data-plan-part="room"]'));
      const turn = page.getByRole("button", { name: "Turned to fit · tap for full size" });
      if (tablet) {
        expect(room.width / room.height).toBeCloseTo(514 / 274, 2);
        // At least three times the area it had upright in the same room beside the list.
        const row = await edgesOf(plan.getByRole("group", { name: /^Garage, / }).locator(".."));
        const [width, height] = [row.right - row.left - 248, row.bottom - row.top];
        const upright = Math.min((width - 88) / 274, (height - 88) / 514);
        expect((room.width / 514 / upright) ** 2, "times the area").toBeGreaterThanOrEqual(3);
        // A tap opens it the right way up.
        await turn.click();
        const card = page.getByRole("dialog", { name: "Garage floor plan" });
        const full = await boxOf(card.locator('[data-plan-part="room"]'));
        expect(full.width / full.height).toBeCloseTo(274 / 514, 2);
        await shot(page, `planning-home-plan-upright-${viewport.width}x${viewport.height}`);
        await card.getByRole("button", { name: "Close" }).click();
        await expect(card).toBeHidden();
      } else {
        expect(room.width / room.height).toBeCloseTo(274 / 514, 2);
        await expect(turn).toHaveCount(0);
        // As wide as the block lets it be.
        expect(drawing.right - drawing.left).toBeGreaterThan(0.9 * (block.right - block.left - 28));
      }

      // No block runs over another, nor, from a tablet up, over the message box (on the cover
      // screen the page scrolls under its pinned Talk and Type).
      const under = await edgesOf(projects);
      expect(apart(block, under), "the plan and the projects apart").toBe(true);
      if (viewport.width >= 600) {
        const box = await edgesOf(page.getByLabel("Message", { exact: true }));
        expect(apart(block, box), "the plan and the message box apart").toBe(true);
        expect(apart(under, box), "the projects and the message box apart").toBe(true);
      }
      await shot(page, `planning-home-plan-${viewport.width}x${viewport.height}`);
    });
  });
}

// A room squarer than the garage stays the right way up on Home (#669).
test.describe("a squarer room on Home", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 950, height: 712 } });

  test("isn't turned", async ({ page }) => {
    const name = `Square room ${Date.now()}`;
    await drawn(page, name, OFFICE);
    await page.getByRole("link", { name: `Back to ${name}` }).click();
    const plan = page.getByRole("figure", { name: "Office floor plan" });
    await expect(plan).toBeVisible();
    const room = await boxOf(plan.locator('[data-plan-part="room"]'));
    expect(room.width / room.height).toBeCloseTo(272 / 329, 2);
    await expect(plan.getByRole("button", { name: /^Turned to fit/ })).toHaveCount(0);
  });
});

// A house's floors, as the owner's are (#670): each drawn from the developer's room table.
const GROUND = {
  room: "Ground floor",
  width: 700,
  depth: 784,
  front: "Front of house",
  beyond: { back: "Garden" },
  zones: [
    { name: "Utility", fromLeft: 0, fromBack: 0, width: 179, depth: 153 },
    { name: "WC", fromLeft: 0, fromBack: 163, width: 170, depth: 90 },
    { name: "Kitchen", fromLeft: 191, fromBack: 0, width: 269, depth: 252 },
    { name: "Dining", fromLeft: 460, fromBack: 0, width: 240, depth: 252 },
    { name: "Garage", fromLeft: 0, fromBack: 270, width: 274, depth: 514 },
    { name: "Lounge", fromLeft: 393, fromBack: 264, width: 307, depth: 446 },
  ],
};
const FIRST = {
  room: "First floor",
  width: 700,
  depth: 723,
  front: "Front of house",
  beyond: { back: "Garden" },
  zones: [
    { name: "En suite", fromLeft: 0, fromBack: 0, width: 203, depth: 141 },
    { name: "Bathroom", fromLeft: 217, fromBack: 0, width: 195, depth: 191 },
    { name: "Bedroom 3", fromLeft: 428, fromBack: 0, width: 272, depth: 329 },
    { name: "Bedroom 1", fromLeft: 0, fromBack: 150, width: 277, depth: 436 },
    { name: "Bedroom 2", fromLeft: 393, fromBack: 340, width: 307, depth: 383 },
  ],
};

for (const viewport of [
  { width: 950, height: 662 },
  { width: 950, height: 712 },
  { width: 400, height: 900 },
]) {
  test.describe(`a house on Home at ${viewport.width}×${viewport.height}`, () => {
    test.use({ hasTouch: true, isMobile: true, viewport });

    test("shows its floors to one scale, each named and each room sized (#670)", async ({
      page,
    }) => {
      const name = `House ${Date.now()}`;
      await newWorkspace(page, name);
      const path = new URL(page.url()).pathname;
      if (viewport.width < 600) await page.getByRole("button", { name: "Type" }).tap();
      await startSaving(page, [messageWith(GROUND), messageWith(FIRST)].join("\n\n"));
      await expect(page.getByRole("list", { name: "Session" })).toContainText(
        /Your turn · finished/,
      );
      await page.getByRole("link", { name: `Back to ${name}` }).click();

      const plans = page.getByRole("figure", { name: `${name} floor plans` });
      await expect(plans).toBeVisible();
      await expect(plans).toContainText(`Plan · ${name}`);
      // No overall size: each floor's outline is added up from its rooms.
      await expect(plans).not.toContainText(/\d\.\d m/);
      const block = await edgesOf(plans.locator("xpath=../.."));
      const ground = plans.getByRole("region", { name: "Ground floor" });
      const first = plans.getByRole("region", { name: "First floor" });
      const scaleOf = async (floor: Locator) =>
        (await boxOf(floor.locator('[data-plan-part="room"]'))).width / 700;

      if (viewport.width >= 600) {
        // Side by side, ground first, each named above it, to one scale.
        const [left, right] = [await edgesOf(ground), await edgesOf(first)];
        expect(left.right).toBeLessThanOrEqual(right.left);
        await expect(ground.getByText("Ground", { exact: true })).toBeVisible();
        await expect(first.getByText("First", { exact: true })).toBeVisible();
        expect(await scaleOf(ground)).toBeCloseTo(await scaleOf(first), 5);
        expectInside(left, block, "The ground floor");
        expectInside(right, block, "The first floor");
        await expect(plans.getByRole("radio")).toHaveCount(0);
        // Each room with its size under its name.
        await expect(ground.locator('[data-plan-part="zone-size"]')).toContainText([
          "2.69 × 2.52",
          "2.74 × 5.14",
        ]);
        await expect(first.locator('[data-plan-part="zone-size"]')).toContainText(["2.77 × 4.36"]);
      } else {
        // One floor at a time, with a switch, at the same scale either way.
        await expect(first).toHaveCount(0);
        const scale = await scaleOf(ground);
        await expect(ground.locator('[data-plan-part="zone-size"]')).toContainText(["2.74 × 5.14"]);
        await shot(page, `planning-home-floors-ground-${viewport.width}x${viewport.height}`);
        await plans.getByText("First", { exact: true }).tap();
        await expect(ground).toHaveCount(0);
        await expect(first).toBeVisible();
        expect(await scaleOf(first)).toBeCloseTo(scale, 5);
        expectInside(await edgesOf(first), block, "The first floor");
      }
      await shot(page, `planning-home-floors-${viewport.width}x${viewport.height}`);

      // And it loads without moving.
      const shifts = await shiftsOn(page, path, (loaded) =>
        expect(loaded.getByRole("figure", { name: `${name} floor plans` })).toBeVisible(),
      );
      const total = shifts.reduce((sum, shift) => sum + shift.value, 0);
      expect(total, JSON.stringify(shifts, null, 2)).toBeLessThan(0.001);
    });
  });
}

// The owner's garage, as saved (2026-10-21): no garage door width, a boiler and a projecting wall
// with no length, the fridge freezer at its Thing's size.
const OWNERS_GARAGE = {
  room: "Garage",
  width: 274,
  depth: 514,
  measured: true,
  front: "Garage door",
  beyond: { right: "House" },
  items: [
    { name: "Projecting wall", fromLeft: 261, fromBack: 454, width: 13 },
    { name: "Boiler", wall: "left", at: 0 },
    { name: "Fridge freezer", fromLeft: 214, fromBack: 0, width: 60, depth: 61 },
  ],
};

test.describe("on Home, opened small and then grown (#674)", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 1000, height: 690 } });

  test("the garage's plan still draws, turned: its frame settles instead of looping", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const name = `Grown garage ${Date.now()}`;
    await newWorkspace(page, name);
    await startSaving(
      page,
      [
        `Here's the garage:\n\n\`\`\`plan\n${JSON.stringify(OWNERS_GARAGE)}\n\`\`\`\n`,
        project("Remootio reset and sensor fix", "Get a replacement magnet"),
        project("Split the garage in two", "Use half the garage as a tidy work area"),
      ].join("\n"),
    );
    await expect(page.getByRole("list", { name: "Session" })).toContainText(/Your turn · finished/);
    // As the Fold does while it settles: Home first laid out small, then at its full size.
    await page.setViewportSize({ width: 1000, height: 160 });
    await page.getByRole("link", { name: `Back to ${name}` }).click();
    await expect(
      page.getByText(/Plan · Garage|Couldn't draw this floor plan/i).first(),
    ).toBeAttached();
    await page.setViewportSize({ width: 1000, height: 690 });

    const plan = page.getByRole("figure", { name: "Garage floor plan" });
    await expect(plan).toBeVisible();
    await expect(plan.getByText("Turned to fit")).toBeVisible();
    await expect(page.getByText("Couldn't draw this floor plan")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
