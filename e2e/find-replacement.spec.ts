import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";
import { openTab } from "./workspace-page.ts";

// Upcoming parts and Find a replacement (#602, ADR 0032): buying starts from the part. Its card's
// Find a replacement fills in the session's first message with a budget to tap; the answer's
// options each have Pick, which makes one the part's upcoming one; "… fitted" swaps it in, with
// Undo.

/** Options for the pedals, as a model would answer Find a replacement, the fake echoing them. */
const OPTIONS = [
  "Three under £50. The DMR V8 is the one: most grip, lasts for years.",
  "",
  "```options",
  JSON.stringify({
    part: "things/pedals.md",
    options: [
      {
        name: "DMR V8",
        price: "about £28",
        shop: "Tredz",
        link: "https://shop.example/dmr-v8",
        why: "Most grip, tough. The usual first upgrade.",
      },
      {
        name: "Nukeproof Neutron",
        price: "about £25",
        link: "https://shop.example/neutron",
        why: "Thinner and lighter, a little less grip.",
      },
      {
        name: "Rockrider flats",
        price: "about £15",
        shop: "Decathlon",
        link: "https://shop.example/rockrider",
        why: "Cheapest. Fine to start, wears quicker.",
      },
    ],
  }),
  "```",
].join("\n");

/** The screen as it is, kept with the test's results, for a pull request to show. */
const shot = async (page: Page, testInfo: TestInfo, name: string) => {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
};

/** A bike with its pedals, as a model would add them, then the pedals' card. */
const openPedals = async (page: Page, name: string) => {
  await newWorkspace(page, name);
  await startSaving(
    page,
    [
      "thing add: name Boardman MHT 8.6 | status have | price £650",
      "thing add: name Pedals | status have | brand Wellgo alloy flats | part of T1",
    ].join("\n"),
  );
  await expect(page.getByRole("list", { name: "Session" })).toContainText(/Your turn · finished/);
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await openTab(page, "Things");
  await page
    .getByRole("region", { name: "Things" })
    .getByRole("link", { name: /Pedals/ })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Pedals" })).toBeVisible();
};

test("Find a replacement: a budget tapped, the options' Pick, and the part shows it upcoming, fitted with Undo", async ({
  page,
}, testInfo) => {
  const name = `Mountain biking ${Date.now()}`;
  await openPedals(page, name);
  await expect(page.getByRole("region", { name: "Upcoming" })).toHaveCount(0);

  // Filled in, for the owner to see before anything goes: the part, what's fitted, budgets.
  await page.getByRole("link", { name: "Find a replacement" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Find a replacement" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Pedals" })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).toContainText("Replace my pedals (Wellgo alloy flats).");
  const budgets = page.getByRole("group", { name: "Budget" });
  await expect(budgets.getByRole("radio")).toHaveCount(3);
  await expect(budgets).toContainText("Under £50");
  await expect(budgets).toContainText("£50–100");
  await expect(budgets).toContainText("Best value");
  await expect(page.getByLabel("Message", { exact: true })).not.toBeFocused();
  await shot(page, testInfo, "find-replacement-filled-in");

  // One tap starts the session with the budget.
  await budgets.getByText("Under £50").click();
  const session = page.getByRole("list", { name: "Session" });
  await expect(session).toContainText(
    "You said: Replace my pedals (Wellgo alloy flats). Budget: under £50",
  );
  await expect(session).toContainText(/Your turn · finished/);

  // The answer's options, side by side, the model's pick first; Pick makes one upcoming.
  await page.getByLabel("Message", { exact: true }).fill(OPTIONS);
  await page.getByRole("button", { name: "Send" }).click();
  const options = page.getByRole("list", { name: "Options for Pedals" });
  await expect(options.getByRole("listitem")).toHaveCount(3);
  const v8 = options.getByRole("listitem", { name: "DMR V8" });
  await expect(v8).toContainText("about £28 · Tredz ›");
  await expect(v8.getByRole("link", { name: "Tredz ›" })).toHaveAttribute(
    "href",
    "https://shop.example/dmr-v8",
  );
  await expect(options.getByRole("listitem", { name: "Nukeproof Neutron" })).toContainText(
    "about £25 · Shop ›",
  );
  await v8.getByRole("button", { name: "Pick" }).click();
  await expect(v8).toContainText("Upcoming");
  await expect(v8.getByRole("button", { name: "Pick" })).toHaveCount(0);
  await expect(options.getByRole("button", { name: "Pick" })).toHaveCount(2);
  await shot(page, testInfo, "find-replacement-options");

  // The part's card: what's fitted beside what's coming, and its history says it was picked.
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await openTab(page, "Things");
  await page
    .getByRole("region", { name: "Things" })
    .getByRole("link", { name: /Pedals/ })
    .click();
  await expect(page.getByRole("region", { name: "Fitted" })).toContainText("Wellgo alloy flats");
  const upcoming = page.getByRole("region", { name: "Upcoming" });
  await expect(upcoming).toContainText("DMR V8 · about £28");
  await expect(upcoming).toContainText("Most grip, tough. The usual first upgrade. · Tredz ›");
  await expect(page.getByRole("region", { name: "History" })).toContainText(
    "Picked DMR V8 as upcoming",
  );
  await shot(page, testInfo, "part-card-upcoming");

  // Fitted: it's swapped in, the old one going to its history, and Undo takes it back.
  await page.getByRole("button", { name: "DMR V8 fitted" }).click();
  const fitted = page.getByRole("list", { name: "Just fitted" });
  await expect(fitted).toContainText("FittedDMR V8");
  await expect(upcoming).toHaveCount(0);
  await expect(page.getByRole("main")).toContainText("BrandDMR V8");
  await expect(page.getByRole("region", { name: "History" })).toContainText(
    "Fitted DMR V8, replacing Wellgo alloy flats",
  );
  await fitted.getByRole("button", { name: "Undo" }).click();
  await expect(upcoming).toContainText("DMR V8 · about £28");
  await expect(page.getByRole("region", { name: "Fitted" })).toContainText("Wellgo alloy flats");
});

test("Find a replacement's own budget, talked or typed, goes after the words it filled in", async ({
  page,
}) => {
  await openPedals(page, `Bike ${Date.now()}`);
  await page.getByRole("link", { name: "Find a replacement" }).click();

  await page.getByLabel("Message", { exact: true }).fill("about forty quid");
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "You said: Replace my pedals (Wellgo alloy flats). Budget: about forty quid",
  );
});
