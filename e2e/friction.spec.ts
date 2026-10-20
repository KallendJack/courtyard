import { join } from "node:path";
import { expect, type Page, type Request, test } from "@playwright/test";
import { ATTACHMENTS_FIELD, FrictionReport, MESSAGE_FIELD } from "../packages/contract/index.ts";
import { hear, standInSpeechRecognition } from "./speech-recognition.ts";

// Something's off (#554; Paper, "Tablet · Home: Something's off in the rail" and "… what it fills
// in", with their Desktop and Cover boards): one button on every screen takes the screen as it is,
// the owner says what's wrong, and File it files it through a session in Courtyard's own code
// workspace. The browser tests' worker isn't on GitHub, so where it files, and filing it, are
// answered here; the worker's own tests file it for real.

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};

/** The Fold's screens, and how the sheet names each, with how to talk and stop on it. */
const SCREENS = {
  unfolded: { viewport: { width: 950, height: 712 }, size: "Fold open · 950 × 712", talk: /^Talk/ },
  "the cover screen": {
    viewport: { width: 400, height: 900 },
    size: "Cover · 400 × 900",
    talk: /Tap or hold to talk/,
  },
};

test.use({ hasTouch: true, isMobile: true });

const sheetOf = (page: Page) => page.getByRole("dialog", { name: "Something's off" });
const button = (page: Page) => page.getByRole("button", { name: "Something's off" });

/** Answers where Something's off files: Workbench, standing in for Courtyard's own repository. */
const filesInWorkbench = (page: Page) =>
  page.route("**/api/friction", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      json: { workspace: { id: "workbench", name: "Workbench" }, version: "8d57986" },
    });
  });

/** The report a File it sent, and its screen, read from its multipart form. */
const reportIn = async (request: Request) => {
  const form = await new Response(Uint8Array.from(request.postDataBuffer() ?? []), {
    headers: { "content-type": request.headers()["content-type"] ?? "" },
  }).formData();
  const message = form.get(MESSAGE_FIELD);
  const screen = form.get(ATTACHMENTS_FIELD);
  return {
    report: FrictionReport.parse(JSON.parse(typeof message === "string" ? message : "")),
    screen: screen instanceof File ? { name: screen.name, type: screen.type } : undefined,
  };
};

for (const [name, screen] of Object.entries(SCREENS)) {
  test.describe(`on ${name}`, () => {
    test.use({ viewport: screen.viewport });

    test("takes the screen, hears what's off and files it with what it filled in", async ({
      page,
    }) => {
      await standInSpeechRecognition(page);
      await filesInWorkbench(page);
      const filed = new Promise<Request>((resolve) =>
        page.route("**/api/friction", async (route) => {
          if (route.request().method() !== "POST") return route.fallback();
          resolve(route.request());
          await route.fulfill({
            status: 201,
            json: {
              id: "00000000-0000-4000-8000-000000000554",
              workspaceId: "workbench",
              title: "Something's off: The backup line is unclear",
              createdAt: "2026-10-19T09:00:00.000Z",
              updatedAt: "2026-10-19T09:00:00.000Z",
              busy: true,
            },
          });
        }),
      );
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Workspaces" })).toBeVisible();

      await button(page).tap();

      const sheet = sheetOf(page);
      await expect(sheet).toBeVisible();
      await expect(sheet.getByText("Files it in Workbench")).toBeVisible();
      await expect(sheet.getByRole("img", { name: "The screen as it was" })).toBeVisible();
      const chips = sheet.getByRole("list", { name: "What it filled in" }).getByRole("listitem");
      await expect(chips).toHaveText(["Home", screen.size, "Version 8d57986"]);
      await expect(button(page)).toHaveAttribute("aria-expanded", "true");

      // Talk stays live while the sheet is open, and what's said goes into it.
      const talk = page.getByRole("button", { name: "Talk", exact: true });
      await talk.filter({ hasText: screen.talk }).tap();
      await hear(page, "The backup line is unclear");
      await talk.tap();
      await expect(sheet.getByRole("textbox")).toHaveValue("The backup line is unclear");
      await shot(page, `something-off-${screen.viewport.width}`);

      await sheet.getByRole("button", { name: "File it" }).tap();

      const { report, screen: picture } = await reportIn(await filed);
      expect(report).toEqual({
        said: "The backup line is unclear",
        page: "Home",
        path: "/",
        size: { device: name === "unfolded" ? "unfolded" : "cover", ...screen.viewport },
        version: "8d57986",
        part: null,
      });
      expect(picture).toEqual({ name: "screen.jpg", type: "image/jpeg" });
      await expect(sheet).toBeHidden();
      await expect(button(page)).toHaveAttribute("aria-expanded", "false");
    });
  });
}

test.describe("on the Fold open", () => {
  test.use({ viewport: SCREENS.unfolded.viewport });

  test("names a workspace's page by the workspace", async ({ page }) => {
    await filesInWorkbench(page);
    await page.goto("/workspaces/garage-gym");
    await expect(page.getByRole("heading", { level: 1, name: "Garage gym" })).toBeVisible();

    await button(page).tap();

    const chips = sheetOf(page).getByRole("list", { name: "What it filled in" });
    await expect(chips.getByRole("listitem").first()).toHaveText("Garage gym");
  });

  test("says when there's nowhere to file it, and Cancel closes it", async ({ page }) => {
    await page.goto("/");

    await button(page).tap();

    const sheet = sheetOf(page);
    await expect(
      sheet.getByText(
        "No code workspace is on Courtyard's own repository, so there's nowhere to file it.",
      ),
    ).toBeVisible();
    await expect(sheet.getByRole("button", { name: "File it" })).toBeDisabled();
    await sheet.getByRole("button", { name: "Cancel" }).tap();
    await expect(sheet).toBeHidden();
  });
});
