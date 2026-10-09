import { expect, type Locator, type Page, test } from "@playwright/test";
import { pngOf } from "../apps/worker/src/test-files.ts";
import { newWorkspace, startSaving } from "./saving.ts";

// Things (ADR 0020): a model's Thing saves as notes under its answer, each with Open and Undo;
// the workspace page's Things section, each Thing's card, and the owner's own adds, edits and
// deletes.

/** A small photo as a phone would send it, half red and half blue. */
const photo = (name: string) => ({
  name,
  mimeType: "image/png",
  buffer: Buffer.from(pngOf(60, 40, (x) => (x < 30 ? [200, 60, 60] : [60, 60, 200]))),
});

/** Whether an image has loaded and has something in it. */
const loaded = (image: Locator) =>
  image.evaluate((element) => element instanceof HTMLImageElement && element.naturalWidth > 0);

/** Adds a bike with two parts, and a dropper post the owner wants, as a model would. */
const addKit = async (page: Page) => {
  await startSaving(
    page,
    [
      "thing add: name Whyte T-140 | status have | brand Whyte | bought 2026-10 | price £1,400",
      "thing add: name Chain | status have | brand KMC X11 | bought 2026-10-09 | price £32 | part of T1",
      "thing add: name Cassette | status replace | brand SRAM XG-1150 | bought 2025-03 | part of T1",
      "thing add: name Dropper post | status want | brand OneUp V3 | price about £200",
    ].join("\n"),
  );
  await expect(page.getByRole("list", { name: "Things saved" }).getByRole("listitem")).toHaveCount(
    4,
  );
};

test("the Things section appears with the first Thing, parts under their parent, filtered by status", async ({
  page,
}) => {
  const name = `Kit ${Date.now()}`;
  await newWorkspace(page, name);
  await expect(page.getByRole("region", { name: "Things" })).toHaveCount(0);
  await addKit(page);
  await page.getByRole("link", { name: `Back to ${name}` }).click();

  const things = page.getByRole("region", { name: "Things" });
  const bike = things.getByRole("link", { name: /Whyte T-140/ });
  await expect(bike).toContainText("Whyte · bought Oct 2026 · £1,400");
  await expect(bike).toContainText("Have");
  const parts = things.getByRole("list", { name: "Parts of Whyte T-140" });
  await expect(parts.getByRole("link")).toHaveText([/Cassette/, /Chain/]);
  await expect(parts.getByRole("link", { name: /Cassette/ })).toContainText("Replace");
  await expect(things.getByRole("link", { name: /Dropper post/ })).toContainText(
    "OneUp V3 · about £200",
  );

  // The filter counts every status, parts included, and is clicked as a person would: the
  // radio itself is hidden behind its pill. A part whose Thing is filtered out says
  // what it's part of.
  await things.getByRole("group", { name: "Show" }).getByText("Replace 1").click();
  await expect(things.getByRole("link")).toHaveCount(1);
  await expect(things.getByRole("link", { name: /Cassette/ })).toContainText(
    "SRAM XG-1150 · bought Mar 2025 · part of Whyte T-140",
  );
  await things.getByRole("group", { name: "Show" }).getByText("Have 2").click();
  await expect(things.getByRole("link")).toHaveText([/Whyte T-140/, /Chain/]);
  await things.getByRole("group", { name: "Show" }).getByText("Want 1").click();
  await expect(things.getByRole("link")).toHaveText([/Dropper post/]);
  await things.getByRole("group", { name: "Show" }).getByText("All 4").click();
  await expect(things.getByRole("link")).toHaveCount(4);
});

// A model's Thing saves in the chat.

test("a model's Thing saves show as notes with what changed, and Undo puts one back", async ({
  page,
}) => {
  await newWorkspace(page, `Mountain biking ${Date.now()}`);
  await startSaving(
    page,
    [
      "thing add: name Whyte T-140 | status have | bought 2026-10 | price £1,400",
      "thing add: name Chain | status have | part of T1",
      "thing T2: bought 2026-10-09 | price £32 | history Swapped, the old one was past 0.75%",
    ].join("\n"),
  );

  const notes = page.getByRole("list", { name: "Things saved" });
  await expect(notes.getByRole("listitem").nth(0)).toContainText(
    "Added ThingWhyte T-140 (have, bought Oct 2026, £1,400)",
  );
  await expect(notes.getByRole("listitem").nth(1)).toContainText(
    "Added ThingChain (have, part of Whyte T-140)",
  );
  const swapped = notes.getByRole("listitem").nth(2);
  await expect(swapped).toContainText("Updated Thing");
  await expect(swapped).toContainText(
    "Chain (bought 9 Oct 2026, £32; history: Swapped, the old one was past 0.75%)",
  );

  await swapped.getByRole("button", { name: "Undo" }).click();
  await expect(swapped).toContainText("Undone");
  await expect(swapped.getByRole("button", { name: "Undo" })).toHaveCount(0);
});

test("a Thing save's Open goes to its card: its details, history, the Thing it's part of and its parts", async ({
  page,
}) => {
  const name = `Bikes ${Date.now()}`;
  await newWorkspace(page, name);
  await addKit(page);
  // Listed by name, each part after its Thing, the chain is T4.
  await page
    .getByLabel("Message")
    .fill(
      "thing T4: condition New | size 11-speed, 118 links | where On the bike | history Fitted, replacing the last X11",
    );
  await page.getByRole("button", { name: "Send" }).click();
  const notes = page.getByRole("list", { name: "Things saved" }).last();
  await expect(notes).toContainText("Updated Thing");
  await notes.getByRole("link", { name: "Open" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Chain" })).toBeVisible();
  await expect(page.getByRole("link", { name: `Back to ${name}` })).toContainText(
    `${name} · Things · Whyte T-140`,
  );
  const main = page.getByRole("main");
  await expect(main).toContainText("Have");
  for (const detail of [
    "BrandKMC X11",
    "Bought9 Oct 2026",
    "Price£32",
    "ConditionNew",
    "Size11-speed, 118 links",
    "WhereOn the bike",
    "Part ofWhyte T-140",
  ]) {
    await expect(main).toContainText(detail);
  }
  await expect(page.getByRole("region", { name: "History" })).toContainText(
    "Fitted, replacing the last X11",
  );

  // Its Thing's card lists its parts, as the workspace page does.
  await main.getByRole("link", { name: "Whyte T-140" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Whyte T-140" })).toBeVisible();
  const parts = page.getByRole("list", { name: "Parts of Whyte T-140" });
  await expect(parts.getByRole("link")).toHaveText([/Cassette/, /Chain/]);
  await expect(page.getByRole("region", { name: "History" })).toHaveCount(0);

  // Recent changes opens a Thing's card too.
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await page.getByRole("link", { name: "Recent changes" }).click();
  const changes = page.getByRole("list", { name: "Recent changes" });
  await changes
    .getByRole("listitem")
    .filter({ hasText: "Added ThingDropper post" })
    .getByRole("link", { name: "Open" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Dropper post" })).toBeVisible();
});

test("the owner adds, edits and deletes Things themselves, and Undo brings a deleted one back", async ({
  page,
}) => {
  const name = `Garage ${Date.now()}`;
  await newWorkspace(page, name);
  await addKit(page);
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  const things = page.getByRole("region", { name: "Things" });

  // Add Thing opens the same form as Edit, empty.
  await things.getByRole("button", { name: "Add Thing" }).click();
  const adding = things.getByRole("form", { name: "Add Thing" });
  await adding.getByRole("textbox", { name: "Name" }).fill("Tyres");
  await adding.getByRole("group", { name: "Status" }).getByText("Replace").click();
  await adding.getByRole("textbox", { name: "Brand" }).fill("Maxxis Minion DHF 2.5");
  await adding.getByRole("textbox", { name: "Bought" }).fill("May 2026");
  await adding.getByRole("combobox", { name: "Part of" }).selectOption("Whyte T-140");
  const chooser = page.waitForEvent("filechooser");
  await adding.getByRole("button", { name: "Photo" }).click();
  await (await chooser).setFiles([photo("tyres.png")]);
  await expect(adding.getByRole("button", { name: "Photo" })).toContainText("tyres.jpg");
  await adding.getByRole("button", { name: "Save" }).click();
  await expect(adding).toHaveCount(0);
  const tyres = things
    .getByRole("list", { name: "Parts of Whyte T-140" })
    .getByRole("link", { name: /Tyres/ });
  await expect(tyres).toContainText("Maxxis Minion DHF 2.5 · bought May 2026");
  await expect(tyres).toContainText("Replace");
  await expect.poll(() => loaded(tyres.locator("img"))).toBe(true);

  // Edit, from its card: a blank detail is cleared.
  await tyres.click();
  await page.getByRole("button", { name: "Edit" }).click();
  const editing = page.getByRole("form", { name: "Edit Tyres" });
  await expect(editing.getByRole("textbox", { name: "Bought" })).toHaveValue("May 2026");
  await editing.getByRole("group", { name: "Status" }).getByText("Have").click();
  await editing.getByRole("textbox", { name: "Bought" }).fill("");
  await editing.getByRole("textbox", { name: "Price" }).fill("£110 the pair");
  await editing.getByRole("button", { name: "Save" }).click();
  await expect(editing).toHaveCount(0);
  const main = page.getByRole("main");
  await expect(main).toContainText("Price£110 the pair");
  await expect(main).not.toContainText("Bought");

  // A Thing with parts can't go first.
  await main.getByRole("link", { name: "Whyte T-140" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(main).toContainText("Its parts come first");
  await expect(page.getByRole("heading", { level: 1, name: "Whyte T-140" })).toBeVisible();

  // Delete goes at once, and the workspace page offers Undo.
  await page
    .getByRole("list", { name: "Parts of Whyte T-140" })
    .getByRole("link", { name: /Tyres/ })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(things).toContainText("DeletedTyres");
  await expect(things.getByRole("link", { name: /Tyres/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Documents" })).toHaveCount(0);
  await things.getByRole("button", { name: "Undo" }).click();
  await expect(things.getByRole("link", { name: /Tyres/ })).toBeVisible();
  await expect(things).not.toContainText("Deleted");

  // Each change is in Recent changes, the delete marked undone.
  await page.getByRole("link", { name: "Recent changes" }).click();
  const changes = page.getByRole("list", { name: "Recent changes" });
  await expect(changes.getByRole("listitem").first()).toContainText("UndoneTyres");
  await expect(changes.getByRole("listitem").first()).toContainText("removed, then undone");
  await expect(changes).toContainText("Changed ThingTyres");
  await expect(changes).toContainText("Added ThingTyres");
});

test("a photo from an attachment shows on its Thing's card and row, and the card uploads another", async ({
  page,
}) => {
  const name = `Helmets ${Date.now()}`;
  await newWorkspace(page, name);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach photos or PDFs" }).click();
  await (await chooser).setFiles([photo("helmet.png")]);
  await startSaving(
    page,
    "thing add: name Helmet | status have | brand Fox Speedframe | photo 1\nthing add: name Gloves | status want",
  );
  const notes = page.getByRole("list", { name: "Things saved" });
  await expect(notes.getByRole("listitem")).toHaveCount(2);
  await notes.getByRole("listitem").first().getByRole("link", { name: "Open" }).click();

  const helmet = page.getByRole("img", { name: "Photo of Helmet" });
  await expect(helmet).toBeVisible();
  await expect.poll(() => loaded(helmet)).toBe(true);
  await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible();

  await page.getByRole("link", { name: `Back to ${name}` }).click();
  const rows = page.getByRole("region", { name: "Things" });
  const row = rows.getByRole("link", { name: /Helmet/ });
  // The row's photo is decoration beside the name, so screen readers skip it.
  await expect.poll(() => loaded(row.locator("img"))).toBe(true);

  // A Thing with no photo gets one on its card.
  await rows.getByRole("link", { name: /Gloves/ }).click();
  await expect(page.getByRole("img", { name: "Photo of Gloves" })).toHaveCount(0);
  const upload = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload photo" }).click();
  await (await upload).setFiles([photo("gloves.png")]);
  const gloves = page.getByRole("img", { name: "Photo of Gloves" });
  await expect(gloves).toBeVisible();
  await expect.poll(() => loaded(gloves)).toBe(true);
  await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible();
});
