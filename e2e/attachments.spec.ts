import { expect, type Page, test } from "@playwright/test";
import { pdfOf, pngOf } from "../apps/worker/src/test-files.ts";

// Photos and PDFs in a message (#78). The fake says what it was given when a message says
// "please look".

type FileToAttach = { name: string; mimeType: string; buffer: Buffer };

const photo = (name: string): FileToAttach => ({
  name,
  mimeType: "image/png",
  buffer: Buffer.from(pngOf(60, 40, (x) => (x < 30 ? [200, 60, 60] : [60, 60, 200]))),
});

const MANUAL: FileToAttach = {
  name: "rack-manual.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from(pdfOf(["Titan T-3 J-hooks", "The cup is 64 mm across."])),
};

/**
 * Attaches files with the frame's Add (Photo on the cover screen, #197), through the file picker it
 * opens.
 */
const attach = async (page: Page, files: readonly FileToAttach[]) => {
  const chooser = page.waitForEvent("filechooser");
  const cover = (page.viewportSize()?.width ?? 1280) < 600;
  await page.getByRole("button", { name: cover ? "Photo" : "Add", exact: true }).click();
  await (await chooser).setFiles([...files]);
};

const tray = (page: Page) => page.getByRole("list", { name: "Attachments" });

test("photos and PDFs go with a message, show in it after a reload, and open full size", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");
  await attach(page, [photo("garage.png"), MANUAL, photo("hooks.png")]);

  // Photos are shrunk and sent as JPEG, so their names say so.
  await expect(tray(page).getByRole("img")).toHaveCount(2);
  await expect(tray(page).getByRole("img", { name: "garage.jpg" })).toBeVisible();
  await expect(tray(page)).toContainText("rack-manual.pdf");
  await expect(tray(page)).toContainText(/PDF · \d+ KB/);
  await tray(page).getByRole("button", { name: "Remove hooks.jpg" }).click();
  await expect(tray(page).getByRole("img")).toHaveCount(1);

  await page.getByLabel("Message", { exact: true }).fill("please look");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/workspaces\/garage-gym\/sessions\//);

  const session = page.getByRole("list", { name: "Session" });
  await expect(session).toContainText(
    "I see garage.jpg (a photo) and rack-manual.pdf (a PDF). You said: please look",
  );
  await page.reload();
  const pdf = session.getByRole("link", { name: /rack-manual\.pdf/ });
  await expect(pdf).toHaveAttribute("target", "_blank");
  await expect(pdf).toHaveAttribute("href", /\/api\/sessions\/.+\/attachments\//);

  await session.getByRole("button", { name: "View garage.jpg" }).click();
  const viewer = page.getByRole("dialog", { name: "garage.jpg" });
  await expect(viewer).toContainText("1 of 1");
  await expect(viewer.getByRole("img", { name: "garage.jpg" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();

  // A later turn still has them.
  await page.getByLabel("Message", { exact: true }).fill("please look again");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(session).toContainText(
    "I see garage.jpg (a photo) and rack-manual.pdf (a PDF). You said: please look again",
  );
});

test("what can't go is left out and said in one line, and the rest stay", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");
  await attach(page, [
    { name: "garage-tour.mov", mimeType: "video/quicktime", buffer: Buffer.from("not a photo") },
    {
      name: "boiler-manual.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
    },
    photo("garage.png"),
  ]);

  await expect(page.getByRole("alert")).toHaveText(
    "garage-tour.mov can't be attached: only photos and PDFs. boiler-manual.pdf is over 20 MB.",
  );
  await expect(tray(page).getByRole("img", { name: "garage.jpg" })).toBeVisible();
});

test("five is the most: a sixth is left out", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");
  await attach(
    page,
    Array.from({ length: 6 }, (_, n) => photo(`photo-${n + 1}.png`)),
  );

  await expect(tray(page).getByRole("img")).toHaveCount(5);
  await expect(page.getByRole("alert")).toHaveText("Only 5 photos or PDFs go with a message.");
});

test("a PDF with no text is refused by the worker, and the attachments stay to fix", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");
  await attach(page, [
    { name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfOf([])) },
  ]);
  await page.getByLabel("Message", { exact: true }).fill("What does this say?");
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "scan.pdf has no text a model can read: it's probably a scan. Send a photo of the page instead.",
  );
  await expect(tray(page)).toContainText("scan.pdf");
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("What does this say?");
});

test("pasting or dropping a photo attaches it", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");
  const png = photo("screenshot.png").buffer.toString("base64");
  const box = page.getByLabel("Message", { exact: true });

  await box.evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  }, png);
  await expect(tray(page).getByRole("img", { name: "pasted.jpg" })).toBeVisible();

  const dropped = await page.evaluateHandle((base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
    return data;
  }, png);
  const form = box.locator("xpath=ancestor::form");
  await form.dispatchEvent("dragenter", { dataTransfer: dropped });
  await expect(page.getByText("Drop photos or PDFs to attach")).toBeVisible();
  await form.dispatchEvent("drop", { dataTransfer: dropped });
  await expect(page.getByText("Drop photos or PDFs to attach")).toBeHidden();
  await expect(tray(page).getByRole("img", { name: "dropped.jpg" })).toBeVisible();
});

test("a picture copied from a web page attaches, but text copied from a document pastes as text", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");
  const png = photo("image.png").buffer.toString("base64");
  const box = page.getByLabel("Message", { exact: true });
  /** Pastes a picture with what else a clipboard holds; whether the box was left to paste text. */
  const paste = (also: { html: string; text: string }) =>
    box.evaluate(
      (element, { base64, html, text }) => {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        const data = new DataTransfer();
        data.items.add(new File([bytes], "image.png", { type: "image/png" }));
        data.setData("text/html", html);
        if (text !== "") data.setData("text/plain", text);
        return element.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
        );
      },
      { base64: png, ...also },
    );

  // Word and Excel copy a selection's text with a picture of it: the text is what's meant.
  const pastedText = await paste({
    html: "<html><body><table><tr><td>Rack</td><td>120 cm</td></tr></table></body></html>",
    text: "Rack\t120 cm",
  });
  expect(pastedText).toBe(true);
  await expect(tray(page)).toBeHidden();

  // A browser's Copy image gives the picture, its HTML only an <img>, and perhaps its address.
  const pastedPicture = await paste({
    html: '<meta charset="utf-8"><img src="https://courtyard.example/rack.png" alt="The rack">',
    text: "https://courtyard.example/rack.png",
  });
  expect(pastedPicture).toBe(false);
  await expect(tray(page).getByRole("img", { name: "image.jpg" })).toBeVisible();
});

// A phone, and a foldable opened out, where the same viewer fills a much wider screen.
for (const screen of [
  { name: "a phone", viewport: { width: 390, height: 844 }, tablet: false },
  { name: "an unfolded foldable", viewport: { width: 884, height: 1104 }, tablet: true },
])
  test.describe(`on the touch screen of ${screen.name}`, () => {
    test.use({ viewport: screen.viewport, hasTouch: true, isMobile: true });

    test("a finger swiped across a photo shows the next one, and back", async ({ page }) => {
      // A touch screen has the Handheld frame: photos from its Photo button (Add, on a tablet),
      // the box from Type on a phone, and always there on a tablet.
      await page.goto("/workspaces/garage-gym");
      const chooser = page.waitForEvent("filechooser");
      await page
        .getByRole("button", { name: screen.tablet ? "Add" : "Photo", exact: true })
        .click();
      await (await chooser).setFiles([photo("garage.png"), photo("hooks.png")]);
      if (!screen.tablet) await page.getByRole("button", { name: "Type" }).click();
      await page.getByLabel("Message", { exact: true }).fill("please look");
      await page.getByRole("button", { name: "Start" }).click();
      const session = page.getByRole("list", { name: "Session" });
      await session.getByRole("button", { name: "View garage.jpg" }).click();
      await expect(page.getByRole("dialog", { name: "garage.jpg" })).toContainText("1 of 2");

      // A real finger: the browser sees it as a touch it could scroll with, not as a mouse.
      const swipe = async (fromX: number, toX: number) => {
        const touch = await page.context().newCDPSession(page);
        const y = 420;
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: fromX, y }],
        });
        for (let step = 1; step <= 6; step++) {
          const x = fromX + ((toX - fromX) * step) / 6;
          await touch.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x, y }],
          });
        }
        await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await touch.detach();
      };

      await swipe(300, 80);
      await expect(page.getByRole("dialog", { name: "hooks.jpg" })).toContainText("2 of 2");
      await swipe(80, 300);
      await expect(page.getByRole("dialog", { name: "garage.jpg" })).toContainText("1 of 2");
    });
  });

// A photo or PDF on its own, with no words (#164): Send goes with only attachments, the message
// shows just them, and the fake, given no words, says what it was given.

test("a photo goes with no words, from a workspace's box and a session's, picked or pasted", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");
  await attach(page, [photo("no-words-plan.png")]);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/sessions\//);
  const session = page.getByRole("list", { name: "Session" });
  await expect(session).toContainText("I see no-words-plan.jpg (a photo).");
  await expect(session.getByRole("button", { name: "View no-words-plan.jpg" })).toBeVisible();
  await expect(session).not.toContainText("You said:");
  // Titled by the photo until a model titles it.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("no-words-plan.jpg");

  // A pasted screenshot, with nothing typed, goes from the session's box too.
  const png = photo("no-words-screenshot.png").buffer.toString("base64");
  await page.getByLabel("Message", { exact: true }).evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "no-words-screenshot.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  }, png);
  await expect(tray(page).getByRole("img", { name: "no-words-screenshot.jpg" })).toBeVisible();
  await page.getByRole("button", { name: "Send" }).click();
  await expect(session).toContainText(
    "I see no-words-plan.jpg (a photo) and no-words-screenshot.jpg (a photo).",
  );
  await expect(tray(page)).toBeHidden();
});

test("with no words and nothing attached, Start sends nothing", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/workspaces\/garage-gym$/);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

// The Fold opened out, with its docked Reply box (#206), and folded, on its cover screen.
for (const screen of [
  { name: "the unfolded Fold", viewport: { width: 950, height: 712 }, add: "Add" },
  { name: "the Fold's cover screen", viewport: { width: 400, height: 900 }, add: "Photo" },
])
  test.describe(`on ${screen.name}`, () => {
    test.use({ viewport: screen.viewport, hasTouch: true, isMobile: true });

    test("a photo, then a PDF, goes with no words from the frame's button", async ({ page }) => {
      const pick = async (files: readonly FileToAttach[]) => {
        const chooser = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: screen.add, exact: true }).click();
        await (await chooser).setFiles([...files]);
        await expect(tray(page)).toBeVisible();
      };
      await page.goto("/workspaces/garage-gym");
      await pick([photo("fold-floor-plan.png")]);
      await page.getByRole("button", { name: "Start" }).click();
      const session = page.getByRole("list", { name: "Session" });
      await expect(session).toContainText("I see fold-floor-plan.jpg (a photo).");
      await expect(session.getByRole("button", { name: "View fold-floor-plan.jpg" })).toBeVisible();

      await pick([MANUAL]);
      await page.getByRole("button", { name: "Send" }).click();
      await expect(session).toContainText(
        "I see fold-floor-plan.jpg (a photo) and rack-manual.pdf (a PDF).",
      );
    });
  });
