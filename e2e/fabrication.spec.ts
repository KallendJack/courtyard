import { expect, type Page, test } from "@playwright/test";
import { goldenBench } from "../packages/fabrication/bench/fixtures/golden.ts";
import { newWorkspace, startSaving } from "./saving.ts";

// Fabrication (#698, ADR 0036; Paper, 2 · Agreed, "Fabrication · A Build · Tablet (#698)",
// "· Desktop 1440×900 (#698)" and "· A Build, buy list · Cover (#698)"): a project step's Build
// opens in Fabrication, served under /fabrication behind Courtyard's login, with its 3D view, cut
// plan, buy list and a chat in its session. The worker's side is in fabrication-chat.test.ts.

const STEP = "Build the workbench";

/**
 * A workspace with a project whose first step owns the golden bench, made as the model makes them:
 * the project in one session, then the Build given to its step in another. Ends on its Home.
 */
const workspaceWithBuild = async (page: Page) => {
  const name = `Garage ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(
    page,
    `project: ${JSON.stringify({
      name: "Split the garage",
      add_steps: [{ kind: "you can do this", text: STEP }],
    })}`,
  );
  await expect(page.getByRole("list", { name: "Projects saved" })).toContainText("Started project");
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await startSaving(
    page,
    `build: ${JSON.stringify({
      // Not "Workbench": its tile on Home would then match home.spec's seeded Workbench tile.
      name: "Split bench",
      template: "framed-bench",
      parameters: goldenBench,
      project: "P1",
      step: 1,
    })}`,
  );
  await expect(page.getByRole("list", { name: "Builds saved" })).toContainText("Started Build");
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  return name;
};

/** From Home, the project's page, and its step's Open in Fabrication. */
const openInFabrication = async (page: Page) => {
  await page
    .getByRole("region", { name: "Projects" })
    .getByRole("link", { name: "Split the garage" })
    .click();
  await page
    .getByRole("region", { name: "Next" })
    .getByRole("link", { name: "Open in Fabrication" })
    .click();
  // Your tools comes first while the owner has none saved (your-tools.spec.ts).
  const built = page.getByRole("heading", { level: 1, name: "Split bench" });
  const skip = page.getByRole("button", { name: "Skip for now" });
  await expect(built.or(skip)).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await expect(page).toHaveURL(/\/fabrication\/workspaces\/[^/]+\/builds\/split-bench$/);
  await expect(built).toBeVisible();
};

test.describe("on the unfolded Fold", () => {
  test.use({ viewport: { width: 933, height: 645 }, hasTouch: true, isMobile: true });

  test("a step's Build opens in Fabrication: in 3D, its cut plan, buy list, and a part's card", async ({
    page,
  }) => {
    const name = await workspaceWithBuild(page);
    await openInFabrication(page);

    // The top bar: back to its project, its size, and what the making rules found.
    await expect(
      page.getByRole("link", { name: `Back to ${name} · Split the garage` }),
    ).toBeVisible();
    await expect(page.getByText("1500 × 600 × 899.6 mm · framed bench")).toBeVisible();
    await expect(page.getByRole("button", { name: "2 to check" })).toBeVisible();
    const toCheck = page.getByRole("list", { name: "To check" });
    await expect(toCheck).toContainText("M6 × 50 bolts too short");
    await expect(toCheck).toContainText("Spanner and Spirit level not to hand");

    // Three panels: the chat, the bench in 3D, and the cut plan.
    await expect(page.getByRole("region", { name: "Chat" })).toContainText("Started the Build");
    const bench = page.getByRole("region", { name: "In 3D" });
    await expect(bench.getByRole("heading", { name: "The bench" })).toBeVisible();
    const cutPlan = page.getByRole("region", { name: "Cut plan" });
    await expect(cutPlan).toContainText("Each saw cut takes 3 mm · assumed");
    await expect(cutPlan.getByRole("button", { name: "B, 1450 mm" })).toHaveCount(1);
    await expect(cutPlan).toContainText("45 × 95 C16, 2.4 m× 4");

    // A part tapped in the key lights it in the cut plan too, and opens its card.
    await bench
      .getByRole("list", { name: "Parts" })
      .getByRole("button", { name: "B Long rails" })
      .click();
    const card = bench.getByRole("region", { name: "B, Long rails" });
    await expect(card).toContainText("Long rails × 4");
    await expect(card).toContainText("Front and back, top and bottom.");
    await expect(card).toContainText("1450 × 95 × 45 mm");
    await expect(card).toContainText("45 × 95 C16, 2.4 m");
    await expect(cutPlan.getByRole("button", { name: "B, 1450 mm" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await card.getByRole("button", { name: "Close" }).click();
    await expect(card).toBeHidden();

    // The buy list, with its total.
    await page.getByRole("tab", { name: "Buy list" }).click();
    const buyList = page.getByRole("region", { name: "Buy list" });
    await expect(buyList).toContainText("To buy · 10");
    await expect(buyList.getByRole("link", { name: /45 × 95 C16, 2\.4 m/ })).toHaveAttribute(
      "href",
      "https://shop.example/c16-45x95",
    );
    await expect(buyList).toContainText("Total £172.06");

    await page.getByRole("tab", { name: "Tools" }).click();
    await expect(page.getByRole("region", { name: "Tools" })).toContainText("2 not to hand");
  });

  test("its chat goes to the Build's session, and the answer comes back in it", async ({
    page,
  }) => {
    // The fake echoes the Build's parameters a word at a time before it's free.
    test.slow();
    await workspaceWithBuild(page);
    await openInFabrication(page);

    const chat = page.getByRole("region", { name: "Chat" });
    await expect(chat).toContainText("Started the Build");
    await expect(chat.getByText("Answering…")).toBeHidden({ timeout: 90_000 });
    await chat.getByLabel("Message", { exact: true }).fill("Do the washers come with them?");
    await chat.getByRole("button", { name: "Send" }).click();
    await expect(chat.getByRole("list", { name: "Messages" })).toContainText(
      "You said: Do the washers come with them?",
    );
  });
});

test.describe("on the cover screen", () => {
  test.use({ viewport: { width: 933, height: 645 }, hasTouch: true, isMobile: true });

  test("the panels are tabs", async ({ page }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);
    // Folded, with the Build open.
    await page.setViewportSize({ width: 476, height: 695 });

    const tabs = page.getByRole("tablist", { name: "Show" });
    await expect(tabs.getByRole("tab")).toHaveText([
      "Bench",
      "Chat",
      "Cut plan",
      "Buy list",
      "Tools",
      "Steps",
    ]);
    await expect(page.getByRole("region", { name: "In 3D" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Cut plan" })).toBeHidden();

    await tabs.getByRole("tab", { name: "Buy list" }).click();
    await expect(page.getByRole("region", { name: "Buy list" })).toContainText("Total £172.06");
    await tabs.getByRole("tab", { name: "Chat" }).click();
    await expect(page.getByRole("region", { name: "Chat" })).toContainText("Started the Build");
  });
});

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the three panels, as the desktop board has them", async ({ page }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);

    for (const panel of ["Chat", "In 3D", "Cut plan"]) {
      await expect(page.getByRole("region", { name: panel })).toBeVisible();
    }
  });

  test("the bench stays as the owner turned it when the Build is asked for again", async ({
    page,
  }) => {
    await workspaceWithBuild(page);
    await openInFabrication(page);
    const bench = page.getByRole("region", { name: "In 3D" });
    const canvas = bench.locator("canvas");
    const letter = bench.getByRole("button", { name: "B, Long rails" });
    const placed = () => letter.evaluate((button) => button.style.transform);
    await expect.poll(placed).not.toBe("");
    const first = await placed();

    // Turned by a drag across it, from its corner, clear of the letters.
    const box = await canvas.boundingBox();
    if (box === null) throw new Error("The bench isn't drawn.");
    await page.mouse.move(box.x + 12, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + 172, box.y + 12, { steps: 8 });
    await page.mouse.up();
    await expect.poll(placed).not.toBe(first);
    const turned = await placed();
    await canvas.evaluate((element) => element.setAttribute("data-first", ""));

    // Shown again, the page asks for the Build at once, as it does every 30 seconds.
    const asked = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/builds/split-bench"),
    );
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await asked;
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );

    await expect(bench.locator("canvas[data-first]")).toHaveCount(1);
    await expect(canvas).toHaveCount(1);
    expect(await placed()).toBe(turned);
  });
});

test("Fabrication is behind Courtyard's login", async ({ browser }) => {
  const away = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await away.newPage();
  await page.goto("/fabrication/workspaces/garage-gym/builds/workbench");
  await expect(page).toHaveURL(/\/login$/);
  await away.close();
});

test("Courtyard's service worker leaves Fabrication alone, keeping Courtyard's own page", async ({
  page,
}) => {
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state))
    .toBe("activated");
  await page.goto("/fabrication/");
  await expect(page.getByText("Open a Build from its project in Courtyard.")).toBeVisible();

  const kept = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const entry of await (await caches.open(name)).keys())
        urls.push(new URL(entry.url).pathname);
    }
    const appPage = await caches.match("/index.html");
    return { urls, appPage: appPage === undefined ? "" : await appPage.text() };
  });
  expect(kept.urls.filter((url) => url.startsWith("/fabrication"))).toEqual([]);
  expect(kept.appPage).not.toContain("<title>Fabrication</title>");
});
