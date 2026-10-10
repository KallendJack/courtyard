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

/** Attaches files with the paperclip, through the file picker it opens. */
const attach = async (page: Page, files: readonly FileToAttach[]) => {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach photos or PDFs" }).click();
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

  await page.getByLabel("Message").fill("please look");
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
  await page.getByLabel("Message").fill("please look again");
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

test("five is the most: a sixth is left out and the paperclip greys out", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");
  await attach(
    page,
    Array.from({ length: 6 }, (_, n) => photo(`photo-${n + 1}.png`)),
  );

  await expect(tray(page).getByRole("img")).toHaveCount(5);
  await expect(page.getByRole("alert")).toHaveText("Only 5 photos or PDFs go with a message.");
  await expect(page.getByText("5 of 5")).toBeVisible();
  await expect(page.getByRole("button", { name: "Attach photos or PDFs" })).toBeDisabled();
});

test("a PDF with no text is refused by the worker, and the attachments stay to fix", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym");
  await attach(page, [
    { name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfOf([])) },
  ]);
  await page.getByLabel("Message").fill("What does this say?");
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "scan.pdf has no text a model can read: it's probably a scan. Send a photo of the page instead.",
  );
  await expect(tray(page)).toContainText("scan.pdf");
  await expect(page.getByLabel("Message")).toHaveValue("What does this say?");
});

test("pasting or dropping a photo attaches it", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");
  const png = photo("screenshot.png").buffer.toString("base64");
  const box = page.getByLabel("Message");

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
  const box = page.getByLabel("Message");
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

test("a desktop has no camera button", async ({ page }) => {
  await page.goto("/workspaces/garage-gym");
  await expect(page.getByRole("button", { name: "Attach photos or PDFs" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Take a photo" })).toBeHidden();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a camera button opens the camera in one tap, and photos attach in a session", async ({
    page,
  }) => {
    await page.goto("/workspaces/garage-gym");
    await page.getByLabel("Message").fill("Where should the rack go?");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page).toHaveURL(/\/sessions\//);
    // The session page is showing, with its first answer done, so the box is its own.
    await expect(page.getByRole("button", { name: "Copy answer" })).toBeVisible();

    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Take a photo" }).click();
    const camera = await chooser;
    expect(await camera.element().getAttribute("capture")).toBe("environment");
    await camera.setFiles([photo("IMG_2041.png")]);
    await expect(tray(page).getByRole("img", { name: "IMG_2041.jpg" })).toBeVisible();

    await page.getByLabel("Message").fill("please look");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("list", { name: "Session" })).toContainText(
      "I see IMG_2041.jpg (a photo). You said: please look",
    );
  });
});

test.describe("on a touch screen", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("a finger swiped across a photo shows the next one, and back", async ({ page }) => {
    await page.goto("/workspaces/garage-gym");
    await attach(page, [photo("garage.png"), photo("hooks.png")]);
    await page.getByLabel("Message").fill("please look");
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
