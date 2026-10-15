import { join } from "node:path";
import { type APIRequestContext, expect, type Locator, type Page, test } from "@playwright/test";
import {
  finishSpeaking,
  hear,
  micOn,
  spokenAloud,
  standInSpeechRecognition,
  standInSpeechSynthesis,
} from "./speech-recognition.ts";

// Step by step (#241, Paper board "Tablet · Step by step"): an answer with numbered steps offers
// them one at a time, in a planning workspace. Each step is read aloud, Back and Next move, and
// holding Talk, "next", "back" and "repeat" steer it. The fake echoes the message, so a message
// with numbered lines is an answer with steps. Playwright has no voice and no microphone, so the
// test listens and speaks through stand-ins.

/** A message the fake answers with six steps, under a line saying what they're for. */
const PADS = [
  "How do I fit new pads?",
  "",
  "Fitting the pads:",
  "1. Take the wheel out and pull the pad pin. Keep the pin somewhere safe.",
  "2. Slide the old pads and spring out. Note which way the spring sits.",
  "3. Push both pistons back with a plastic tyre lever. Go slowly and evenly. Don't use a screwdriver: it can chip the pistons.",
  "4. Refit the pads. Put the spring between them, as before.",
  "5. Refit the wheel. Line the rotor up between the pads.",
  "6. Bed the pads in. Ten gentle stops from walking pace.",
].join("\n");

/** Starts a session in `workspace` on the fake with `text`, opens it, and waits for its answer. */
const openAnswered = async (
  page: Page,
  request: APIRequestContext,
  workspace: string,
  text: string,
) => {
  const response = await request.post(`/api/workspaces/${workspace}/sessions`, {
    data: { text, model: { provider: "fake", model: "echo" } },
  });
  expect(response.status()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  await page.goto(`/workspaces/${workspace}/sessions/${id}`);
  await expect(page.getByRole("button", { name: "Copy answer" })).toBeVisible();
};

const stepByStepButton = (page: Page) => page.getByRole("button", { name: /^Step by step/ });
const steps = (page: Page) => page.getByRole("region", { name: "Step by step" });
const talking = (page: Page) => page.getByRole("button", { name: "Talk", exact: true });

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};

/** Where a finger goes to press something. */
const centre = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test.beforeEach(async ({ page }) => {
  await standInSpeechRecognition(page);
  await standInSpeechSynthesis(page);
});

test.describe("on the unfolded Fold", () => {
  test.use({ viewport: { width: 950, height: 712 }, hasTouch: true, isMobile: true });

  test("an answer with steps offers them one at a time: each read aloud, Back and Next move, and holding Talk, “next” moves on", async ({
    page,
    request,
  }) => {
    await openAnswered(page, request, "garage-gym", PADS);
    await expect(stepByStepButton(page)).toHaveText("Step by step · all 6");
    await shot(page, "answer-tablet");
    await stepByStepButton(page).click();

    // The first step, read aloud, with the reading line in the Reply box's place.
    await expect(steps(page)).toContainText("Fitting the pads · Step 1 of 6");
    await expect(steps(page).getByRole("heading")).toHaveText(
      "Take the wheel out and pull the pad pin.",
    );
    await expect(steps(page)).toContainText("Keep the pin somewhere safe.");
    await expect(
      page.getByRole("status").filter({ hasText: "Reading step 1 aloud" }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message" })).toHaveCount(0);
    expect(await spokenAloud(page)).toEqual([
      "Step 1. Take the wheel out and pull the pad pin. Keep the pin somewhere safe.",
    ]);
    await expect(steps(page).getByRole("button", { name: "Back", exact: true })).toBeDisabled();

    // Next and Back.
    await steps(page)
      .getByRole("button", { name: "Next: slide the old pads and spring out" })
      .click();
    await expect(steps(page)).toContainText("Step 2 of 6");
    await steps(page).getByRole("button", { name: "Back", exact: true }).click();
    await expect(steps(page)).toContainText("Step 1 of 6");
    await steps(page).getByRole("button", { name: /^Next/ }).click();
    await steps(page).getByRole("button", { name: /^Next/ }).click();
    await expect(steps(page).getByRole("heading")).toHaveText(
      "Push both pistons back with a plastic tyre lever.",
    );
    await expect(steps(page).getByRole("button", { name: /^Next/ })).toHaveText(
      "Next: refit the pads",
    );
    expect((await spokenAloud(page)).at(-1)).toMatch(/^Step 3\. Push both pistons back/);
    await shot(page, "step-tablet");

    // Holding Talk, which says what to say, "next" moves on; the microphone goes off with it.
    await expect(talking(page)).toContainText("Say “next”");
    const talk = await centre(talking(page));
    await page.mouse.move(talk.x, talk.y);
    await page.mouse.down();
    await expect(talking(page)).toHaveAttribute("aria-pressed", "true");
    await hear(page, "Next");
    await expect(steps(page)).toContainText("Step 4 of 6");
    await page.mouse.up();
    await expect.poll(() => micOn(page)).toBe(false);
    expect((await spokenAloud(page)).at(-1)).toMatch(/^Step 4\. Refit the pads\./);

    // "back" and "repeat" too.
    await talking(page).click();
    await hear(page, "back");
    await expect(steps(page)).toContainText("Step 3 of 6");
    await talking(page).click();
    await hear(page, "repeat");
    await expect.poll(async () => (await spokenAloud(page)).at(-1)).toMatch(/^Step 3\./);
    await expect(steps(page)).toContainText("Step 3 of 6");

    // Pause, finished, and Repeat.
    const line = page.getByRole("status").filter({ hasText: /step 3/i });
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(line).toHaveText("Paused on step 3");
    await page.getByRole("button", { name: "Repeat" }).click();
    await expect(line).toHaveText("Reading step 3 aloud");
    await finishSpeaking(page);
    await expect(line).toHaveText("Step 3 read aloud");

    // Type a reply brings the Reply box back, with the keyboard in it, and Talk talks into it.
    await page.getByRole("button", { name: "Type a reply" }).click();
    await expect(page.getByRole("textbox", { name: "Message" })).toBeFocused();
    await expect(talking(page)).not.toContainText("Say “next”");
    await expect(steps(page)).toContainText("Step 3 of 6");

    // The last step's way on is Done, back to the whole answer, as Full answer is.
    for (const _ of [4, 5, 6]) await steps(page).getByRole("button", { name: /^Next/ }).click();
    await expect(steps(page)).toContainText("Step 6 of 6");
    await steps(page).getByRole("button", { name: "Done" }).click();
    await expect(steps(page)).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Session" })).toContainText("Bed the pads in.");
    await stepByStepButton(page).click();
    await steps(page).getByRole("button", { name: "Full answer" }).click();
    await expect(stepByStepButton(page)).toBeVisible();
    await expect(talking(page)).not.toContainText("Say “next”");
  });

  test("an answer without steps, and a code workspace's answer, offer no Step by step", async ({
    page,
    request,
  }) => {
    await openAnswered(page, request, "garage-gym", "Two ideas:\n1. A rack.\n2. A bench.");
    await expect(page.getByRole("list", { name: "Session" })).toContainText("2. A bench.");
    await expect(stepByStepButton(page)).toHaveCount(0);

    await openAnswered(page, request, "side-project", PADS);
    await expect(page.getByRole("list", { name: "Session" })).toContainText("Bed the pads in.");
    await expect(stepByStepButton(page)).toHaveCount(0);
  });
});

test.describe("on the cover screen", () => {
  test.use({ viewport: { width: 400, height: 900 }, hasTouch: true, isMobile: true });

  test("the reading line sits at the page's foot, and the talk strip steers it", async ({
    page,
    request,
  }) => {
    await openAnswered(page, request, "garage-gym", PADS);
    await stepByStepButton(page).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Reading step 1 aloud" }),
    ).toBeVisible();
    await expect(talking(page)).toContainText("Say “next”");
    await steps(page).getByRole("button", { name: /^Next/ }).click();
    await steps(page).getByRole("button", { name: /^Next/ }).click();
    await expect(steps(page)).toContainText("Step 3 of 6");
    await shot(page, "step-cover");

    await talking(page).click();
    await hear(page, "Next.");
    await expect(steps(page)).toContainText("Step 4 of 6");

    // Type opens the box, as Type a reply does.
    await page.getByRole("button", { name: "Type", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Message" })).toBeFocused();
  });
});

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false });

  test("held, Space and “next” move on", async ({ page, request }) => {
    await openAnswered(page, request, "garage-gym", PADS);
    await stepByStepButton(page).click();
    await expect(talking(page)).toContainText("Say “next”");
    await shot(page, "step-desktop");

    await page.keyboard.down("Space");
    await hear(page, "next");
    await expect(steps(page)).toContainText("Step 2 of 6");
    await page.keyboard.up("Space");
    await expect.poll(() => micOn(page)).toBe(false);
  });
});
