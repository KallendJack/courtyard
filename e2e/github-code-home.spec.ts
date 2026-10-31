import { expect, type Page, test } from "@playwright/test";
import { shot, signIn } from "./github.ts";
import { pageScroll, pageScrollsSideways } from "./page-scroll.ts";

// A code workspace's Home (#301; Paper, "Code workspace Home", desktop, tablet and cover screen)
// and connecting Paper from it (#308), on start-worker.mjs's Workbench: its one line, ready
// issues on the fake GitHub in milestones (one claimed), and a helper's pull request whose checks
// passed. Tests here run in order: the last ones build an issue and merge the pull request.

const HOME = "/workspaces/workbench";

/** Home's blocks, by their labels. */
const blocks = (page: Page) => ({
  builders: page.getByRole("region", { name: "Builders" }),
  needsYou: page.getByRole("region", { name: "Needs you" }),
  nextUp: page.getByRole("region", { name: "Next up" }),
});

/** What every Home shows of Workbench before anything is built or merged. */
const showsHome = async (page: Page) => {
  await page.goto(HOME);
  await expect(page.getByRole("heading", { level: 1, name: "Workbench" })).toBeVisible();
  const line = page.getByRole("button", { name: /octo-owner\/workbench/ });
  await expect(line).toContainText("No Paper file");
  // Its one line stays in workspace.json, off the page (#333).
  await expect(page.getByText("Plan and code with AI models")).toHaveCount(0);

  const { needsYou, builders, nextUp } = blocks(page);
  await expect(needsYou).toContainText(/Needs you · \d+/);
  const ready = needsYou.getByRole("listitem", { name: /Builds take turns/ });
  await expect(ready).toContainText("Checks passed · ready to merge");
  await expect(ready.getByRole("button", { name: /^Merge/ })).toBeVisible();
  // No Lead yet: the Builders board keeps its place, with Run and one quiet line (#283, #648).
  await expect(builders).toContainText("Not running · Run starts the next issue");

  // The next in order needs grilling, so Grill is on top (#363); under it the first of the ready
  // issues nobody claimed, with Build; then only the next few titles and the way to the Roadmap,
  // which has the rest (#532).
  await expect(nextUp).toContainText("4 · Code workspaces");
  const grill = nextUp.getByRole("region", { name: "Grill #117" });
  await expect(grill).toContainText("Sub-agents for code review");
  await expect(grill).toContainText("Needs grilling first");
  await expect(nextUp.getByRole("region", { name: "Build #197" })).toContainText(
    "The rail on desktop",
  );
  await nextUpIsSlim(page, {
    titles: "One Reply box everywhere · Usage at a glance · Paste images on the Fold",
    more: 10,
  });

  // Main's newest commit with its build, and no Update: it isn't the live copy's repository.
  const main = page.getByRole("region", { name: "Main" });
  await expect(main).toContainText(/Start [0-9a-f]{7}/);
  await expect(main.getByRole("status")).toHaveText("Passed · 3:00");
  await expect(main.getByRole("button", { name: "Update" })).toHaveCount(0);
  // A tap opens its full graph: its jobs in the workflow's order, whatever order GitHub gave.
  await main.getByRole("button", { name: /Main's build/ }).click();
  const graph = page.getByRole("dialog", { name: "Main's build" });
  await expect(graph.getByRole("list", { name: "Main's build" }).getByRole("listitem")).toHaveText([
    /^Checks: passed/,
    /^Unit tests: passed/,
    /^E2E: passed/,
  ]);
  await graph.getByRole("button", { name: "Done" }).click();
  await expect(graph).toBeHidden();

  // Tabs show once they have something: the Roadmap always (#532), no sessions yet, one pull
  // request, and Designs always (#522).
  const tabs = page.getByRole("navigation", { name: "Workspace tabs" });
  await expect(tabs.getByRole("link")).toHaveText(["Home", "Roadmap", "PRs1", "Designs"]);
  // A code workspace has no context file, Things or skills on its page (#301).
  await expect(page.getByRole("region", { name: "Context file" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Skills" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
};

/**
 * Next up only starts the next thing (#532; Paper, "Code Home, slim Next up"): no queue of rows
 * and no More, one faint Then line naming the next titles, and Whole roadmap saying how many more.
 */
const nextUpIsSlim = async (page: Page, shows: { titles: string; more: number }) => {
  const { nextUp } = blocks(page);
  await expect(nextUp.getByRole("listitem")).toHaveCount(0);
  await expect(nextUp.getByRole("button", { name: /^More/ })).toHaveCount(0);
  await expect(nextUp.getByText("Then", { exact: true })).toBeVisible();
  await expect(nextUp.getByText(shows.titles, { exact: true })).toBeVisible();
  await expect(nextUp.getByRole("link", { name: /^Whole roadmap/ })).toHaveText(
    `Whole roadmap · ${shows.more} more`,
  );
};

/** The Roadmap's block, and a milestone's row in it, by its title. */
const roadmap = (page: Page) => page.getByRole("region", { name: "Milestones, in build order" });
const milestone = (page: Page, title: string) =>
  roadmap(page).getByRole("listitem", { name: title, exact: true });
/** The issues a milestone shows, by their rows' names: "#197 The rail on desktop, Ready". */
const issuesIn = (row: ReturnType<typeof milestone>) =>
  expect.poll(() =>
    row
      .getByRole("listitem", { name: /^#/ })
      .evaluateAll((rows) => rows.map((each) => each.getAttribute("aria-label"))),
  );

/**
 * The Roadmap (#532; Paper, "Roadmap"): every open milestone in the roadmap's order, Later last;
 * the current one open, its issues in its Build order, each in one plain state, the done one
 * folded; the others folded until tapped.
 */
const roadmapShowsTheOrder = async (page: Page) => {
  await expect(roadmap(page).getByRole("listitem", { name: /^(\d+ · |Later)/ })).toHaveText([
    /^4 · Code workspaces\s*Now\s*5 left/,
    /^5 · Tablet hub and voice\s*2 left/,
    /^Later\s*9 left/,
  ]);
  const current = milestone(page, "4 · Code workspaces");
  await expect(current.getByRole("img", { name: "1 of 6 done" }).first()).toBeAttached();
  await issuesIn(current).toEqual([
    "#117 Sub-agents for code review, To grill",
    "#197 The rail on desktop, Ready",
    "#251 One Reply box everywhere, Ready",
    "#199 Claimed by a helper, Building",
    "#283 Nothing moves once drawn, After One Reply box everywhere",
  ]);
  await expect(current.getByRole("button", { name: /1 done/ })).toBeVisible();
  // The others are folded until tapped.
  const next = milestone(page, "5 · Tablet hub and voice");
  await expect(next.getByRole("listitem")).toHaveCount(0);
  await next.getByRole("button", { name: /^5 · Tablet hub and voice/ }).click();
  await issuesIn(next).toEqual([
    "#66 Usage at a glance, To grill",
    "#255 Paste images on the Fold, Ready",
  ]);
  // The done one shows once its row is tapped.
  await current.getByRole("button", { name: /1 done/ }).click();
  await expect(
    current.getByRole("listitem", { name: "#190 Tabs on the code Home, Done" }),
  ).toBeVisible();
  // Tapping an issue opens its summary and its board.
  await current.getByRole("button", { name: /The rail on desktop/ }).click();
  await expect(current).toContainText("The rail stays on screen on a desktop.");
  await expect(current).toContainText("Board: Desktop · Rail (#197)");
  await expect(current.getByRole("link", { name: "Open #197 on GitHub" })).toBeVisible();
};

/** The page doesn't scroll at all: everything on Home is on one screen. */
const homeFitsOneScreen = async (page: Page) => {
  await expect.poll(async () => (await pageScroll(page)).scrolls).toBe(false);
};

/** Whether `box` is wholly on the screen, between its top and `bottom`. */
const onScreen = async (box: ReturnType<Page["locator"]>, bottom: number) => {
  const at = await box.boundingBox();
  if (at === null) throw new Error("Not on the page");
  return at.y >= 0 && at.y + at.height <= bottom + 0.5;
};

/** A block's rows that scroll inside its card (#335): how far they can, and scrolled to their end. */
const rowsScroll = (block: ReturnType<Page["locator"]>) =>
  block.evaluate((card) => {
    const rows = [...card.querySelectorAll("*")].find(
      (each) => getComputedStyle(each).overflowY === "auto" && each.querySelector("li") !== null,
    );
    if (rows === undefined) return { overflows: false };
    const overflows = rows.scrollHeight > rows.clientHeight + 1;
    rows.scrollTop = rows.scrollHeight;
    return { overflows };
  });

/**
 * Next up as the owner saw it (#418): the first issue ready, with Build, and `count` ready issues
 * in all, so no Grill.
 */
const readyOnly = async (page: Page, count: number) => {
  await page.route("**/api/workspaces/workbench/next-up", async (route) => {
    const response = await route.fetch();
    const { issues } = (await response.json()) as { issues: { ready: boolean }[] };
    const ready = issues.filter((issue) => issue.ready).slice(0, count);
    await route.fulfill({ response, json: { issues: ready } });
  });
};

/** Tapping Build on Next up's first issue keeps Start building and Cancel inside its card. */
const buildButtonsFitTheirCard = async (page: Page) => {
  const build = blocks(page).nextUp.getByRole("region", { name: "Build #197" });
  await build.getByRole("button", { name: "Build" }).click();
  const [card, start, cancel] = await Promise.all([
    build.boundingBox(),
    build.getByRole("button", { name: "Start building" }).boundingBox(),
    build.getByRole("button", { name: "Cancel" }).boundingBox(),
  ]);
  if (card === null || start === null || cancel === null) throw new Error("Not on the page");
  for (const button of [start, cancel]) {
    expect(button.x).toBeGreaterThanOrEqual(card.x);
    expect(button.x + button.width).toBeLessThanOrEqual(card.x + card.width);
  }
  await build.getByRole("button", { name: "Cancel" }).click();
  await expect(build.getByRole("button", { name: "Build" })).toBeVisible();
};

test.describe("a code workspace's Home (#301, #308)", () => {
  test.describe.configure({ mode: "serial" });

  test.describe("on a desktop", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("Home shows what waits on the owner and what's next, each block in its place, on one screen", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await showsHome(page);
      await homeFitsOneScreen(page);
      // Next up sits beside Needs you, not under it.
      const [needsBox, nextBox] = [
        await blocks(page).needsYou.boundingBox(),
        await blocks(page).nextUp.boundingBox(),
      ];
      expect(nextBox?.x ?? 0).toBeGreaterThan((needsBox?.x ?? 0) + (needsBox?.width ?? 0));
      await shot(page, "desktop-home");
      await request.post("/api/github/sign-out", { data: {} });
    });

    // #532: the queue moved to the Roadmap; Next up names what's next and how many more.
    test("with five issues ready, Next up has Build, a Then line of the next three, and Whole roadmap · 1 more", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await readyOnly(page, 5);
      await page.goto(HOME);
      await expect(blocks(page).nextUp.getByRole("region", { name: "Build #197" })).toBeVisible();
      await shot(page, "desktop-home-five-ready");
      await nextUpIsSlim(page, {
        titles: "One Reply box everywhere · Paste images on the Fold · A later idea 1",
        more: 1,
      });
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await request.post("/api/github/sign-out", { data: {} });
    });

    test("the Roadmap tab shows every milestone in order, the current one open, each issue in one plain state (#532)", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(`${HOME}#roadmap`);
      const tabs = page.getByRole("navigation", { name: "Workspace tabs" });
      await expect(tabs.getByRole("link", { name: "Roadmap" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await roadmapShowsTheOrder(page);
      await homeFitsOneScreen(page);
      await shot(page, "desktop-roadmap");
      await request.post("/api/github/sign-out", { data: {} });
    });

    // Owner, 2026-10-15: Next up showed one card while two milestones had issues to grill (#463).
    test("Grill is on the first issue to grill in order, wherever it is, with the first ready under it", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.route("**/api/workspaces/workbench/next-up", async (route) => {
        const response = await route.fetch();
        const { issues } = (await response.json()) as { issues: { number: number }[] };
        const json = { issues: issues.filter((issue) => issue.number !== 117) };
        await route.fulfill({ response, json });
      });
      await page.goto(HOME);
      const { nextUp } = blocks(page);
      const grill = nextUp.getByRole("region").first();
      await expect(grill).toHaveAccessibleName("Grill #66");
      await expect(grill).toContainText("Usage at a glance");
      await expect(nextUp.getByRole("region").nth(1)).toHaveAccessibleName("Build #197");
      await expect(nextUp).toContainText("5 · Tablet hub and voice");
      await expect(
        nextUp.getByText("One Reply box everywhere · Paste images on the Fold · A later idea 1", {
          exact: true,
        }),
      ).toBeVisible();
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await request.post("/api/github/sign-out", { data: {} });
    });

    // Owner, 2026-10-19: with an issue to grill on top there was no way to start the Lead (#550);
    // the board's Run starts it, in every workspace (#648).
    test("with Grill on top, the board's Run starts the Lead, and the small Build says Next once it runs", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(HOME);
      const { nextUp, builders } = blocks(page);
      await expect(nextUp.getByRole("region", { name: "Grill #117" })).toBeVisible();
      const build = nextUp.getByRole("region", { name: "Build #197" });
      await expect(build).toContainText("Ready");
      await expect(nextUp.getByRole("button", { name: /Run/ })).toHaveCount(0);
      await builders.getByRole("button", { name: "Run" }).click();
      const dialog = page.getByRole("dialog", { name: "Run", exact: true });
      await expect(dialog).toContainText("beginning with #197 The rail on desktop");
      await expect(dialog).toContainText("Issues that need grilling wait for you.");
      // Every builder allows all until its PR merges (#591, #730): there's no switch for it.
      await expect(dialog).toContainText("allows all until its PR merges");
      await expect(dialog.getByRole("switch")).toHaveCount(0);
      await shot(page, "tablet-code-home-grill-on-top-run-the-build-order");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();

      // Once the Lead runs, the small Build is simply Next (#592; Paper, "Tablet · Builders board,
      // running"): the Builders board says the Lead runs.
      await page.route("**/api/workspaces/workbench/lead", async (route) => {
        const response = await route.fetch();
        const lead = (await response.json()) as object;
        await route.fulfill({ response, json: { ...lead, state: "running" } });
      });
      await page.goto(HOME);
      await expect(build.getByText("Next", { exact: true })).toBeVisible();
      await expect(build.getByRole("button", { name: "Build" })).toBeVisible();
      await expect(nextUp.getByRole("button", { name: /Run/ })).toHaveCount(0);
      await shot(page, "tablet-code-home-grill-on-top-lead-running");
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await request.post("/api/github/sign-out", { data: {} });
    });

    // Owner, 2026-10-18: GitHub's limit ran out and Next up said Nothing ready to build (#519;
    // Paper, "Tablet · Code Home: Next up can't reach GitHub").
    test("when GitHub refuses the read, Next up keeps the last list, says why and as of when, and doesn't move", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(HOME);
      const { nextUp } = blocks(page);
      await expect(nextUp.getByRole("region", { name: "Build #197" })).toBeVisible();
      const before = await nextUp.boundingBox();
      await page.route("**/api/workspaces/workbench/next-up", async (route) => {
        const response = await route.fetch();
        const { issues } = (await response.json()) as { issues: unknown[] };
        const unread = {
          kind: "rate-limited",
          backAt: "2026-10-18T22:13:00.000Z",
          asOf: "2026-10-18T21:52:00.000Z",
        };
        await route.fulfill({ response, json: { issues, unread } });
      });
      await page.goto(HOME);

      await expect(nextUp.getByRole("status")).toHaveText(
        /^GitHub's limit is used up · back at \d{1,2}:\d{2}/,
      );
      // Beside the label, the milestone, as always (#532).
      await expect(nextUp).toContainText("4 · Code workspaces");
      await expect(nextUp).not.toContainText("Nothing ready to build");
      await expect(nextUp.getByRole("region", { name: "Build #197" })).toBeVisible();
      expect(await nextUp.boundingBox()).toEqual(before);
      await shot(page, "desktop-home-github-refused");

      // With nothing known, the line takes the empty line's place.
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.route("**/api/workspaces/workbench/next-up", (route) =>
        route.fulfill({ json: { issues: [], unread: { kind: "unreachable", asOf: null } } }),
      );
      await page.goto(HOME);
      await expect(nextUp.getByRole("status")).toHaveText("Can't reach GitHub");
      await expect(nextUp).not.toContainText("Nothing ready to build");
      await expect(nextUp).not.toContainText("As of");
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await request.post("/api/github/sign-out", { data: {} });
    });

    // Owner rule (2026-10-12): nothing jumps in late. What loads after the page shows the last
    // answer known at once on a revisit, asked for again quietly.
    test("coming back to a code workspace shows its pull requests at once, while they're asked for again", async ({
      page,
      request,
    }) => {
      await signIn(request);
      // The first visit: the list keeps its place, and nothing above it moves when it comes.
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/workspaces/workbench/pull-requests", async (route) => {
        await held;
        await route.continue();
      });
      await page.goto(`${HOME}#prs`);
      const list = page.getByRole("region", { name: /^Pull requests/ });
      await expect(list.locator("[data-placeholder]")).toBeVisible();
      const tabs = page.getByRole("navigation", { name: "Workspace tabs" });
      const [tabsBefore, listBefore] = [await tabs.boundingBox(), await list.boundingBox()];
      release();
      const row = list.getByRole("listitem", { name: /Builds take turns/ });
      await expect(row).toBeVisible();
      expect(await tabs.boundingBox()).toEqual(tabsBefore);
      expect((await list.boundingBox())?.y).toBe(listBefore?.y);
      await page.unrouteAll({ behavior: "ignoreErrors" });

      // GitHub answers slowly from now on: the way back mustn't wait for it.
      await page.route("**/api/workspaces/workbench/pull-requests", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 8000));
        await route.continue();
      });
      const workspaces = page.getByRole("navigation", { name: "Workspaces" });
      await workspaces.getByRole("link", { name: "Side project" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Side project" })).toBeVisible();
      await workspaces.getByRole("link", { name: "Workbench" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Workbench" })).toBeVisible();
      await page
        .getByRole("navigation", { name: "Workspace tabs" })
        .getByRole("link", { name: /^PRs/ })
        .click();
      await expect(row).toBeVisible({ timeout: 2000 });
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await request.post("/api/github/sign-out", { data: {} });
    });
  });

  test.describe("on the unfolded Fold", () => {
    test.use({ viewport: { width: 950, height: 712 }, hasTouch: true, isMobile: true });

    test("Home fits one screen, and Whole roadmap opens the Roadmap", async ({ page, request }) => {
      await signIn(request);
      await showsHome(page);
      await homeFitsOneScreen(page);
      await shot(page, "tablet-home");

      // Next up's cards, Then line and Whole roadmap all show, nothing scrolling inside it.
      const { nextUp } = blocks(page);
      await expect(nextUp.getByRole("link", { name: /^Whole roadmap/ })).toBeInViewport({
        ratio: 1,
      });
      await nextUp.getByRole("link", { name: /^Whole roadmap/ }).click();
      await expect(page).toHaveURL(/#roadmap$/);
      await roadmapShowsTheOrder(page);
      await homeFitsOneScreen(page);
      await shot(page, "tablet-roadmap");
      await request.post("/api/github/sign-out", { data: {} });
    });

    // Reported from the Fold (#335): with seven rows in Needs you the page scrolled, the title and
    // tabs went out of view and Main went under the message box.
    test("with more in Needs you than fits, the page stays one screen and the rows scroll inside its card (#335)", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.route("**/api/workspaces/workbench/pull-requests", async (route) => {
        const response = await route.fetch();
        const { pullRequests } = (await response.json()) as {
          pullRequests: { pullRequest: { number: number; title?: string } }[];
        };
        const [ready] = pullRequests;
        if (ready === undefined) throw new Error("No pull request to copy");
        const more = Array.from({ length: 6 }, (_, at) => ({
          ...ready,
          pullRequest: { ...ready.pullRequest, number: 900 + at, title: `Ready ${at + 1}` },
        }));
        await route.fulfill({ response, json: { pullRequests: [...pullRequests, ...more] } });
      });
      await page.goto(HOME);
      const { needsYou } = blocks(page);
      await expect(needsYou.getByRole("listitem", { name: /Ready 6/ })).toHaveCount(1);
      await homeFitsOneScreen(page);

      // Everything round the blocks is on the screen, and Main ends above the message box.
      const box = page.getByRole("textbox", { name: "Message" });
      const boxTop = (await box.boundingBox())?.y ?? 0;
      const height = page.viewportSize()?.height ?? 0;
      expect(
        await onScreen(page.getByRole("heading", { level: 1, name: "Workbench" }), height),
      ).toBe(true);
      expect(await onScreen(page.getByRole("navigation", { name: "Workspace tabs" }), height)).toBe(
        true,
      );
      expect(await onScreen(page.getByRole("region", { name: "Main" }), boxTop)).toBe(true);
      expect(await onScreen(box, height)).toBe(true);

      // Needs you's rows scroll inside its card, under its heading, which stays put. Under the
      // Builders board it may be only a row or so tall (#592), with Matt's setup line after the
      // rows, so the last row is scrolled to rather than the card's end.
      expect((await rowsScroll(needsYou)).overflows).toBe(true);
      const last = needsYou.getByRole("listitem", { name: /Ready 6/ });
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
      await expect(needsYou.getByRole("heading", { name: /Needs you/ })).toBeInViewport();
      await homeFitsOneScreen(page);
      await shot(page, "tablet-home-long-needs-you");
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await request.post("/api/github/sign-out", { data: {} });
    });

    test("once Build is tapped, Start building and Cancel stay inside its card (#346)", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(HOME);
      await buildButtonsFitTheirCard(page);
      await request.post("/api/github/sign-out", { data: {} });
    });

    test("the connections line opens Connections, with the file named after the workspace picked, and one tap connects it", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(HOME);
      await page.getByRole("button", { name: /octo-owner\/workbench/ }).click();

      const sheet = page.getByRole("dialog", { name: "Connections" });
      await expect(sheet.getByRole("region", { name: "GitHub" })).toContainText(
        "Connected · octo-owner/workbench",
      );
      const files = sheet.getByRole("group", { name: "Paper file" });
      await expect(files.getByRole("radio", { name: "Workbench" })).toBeChecked();
      await expect(files.locator("label", { hasText: "Workbench" })).toContainText("Same name");
      await expect(files.getByRole("radio", { name: "Courtyard" })).not.toBeChecked();
      await expect(files.getByRole("radio", { name: "Make a new file" })).toBeVisible();
      await shot(page, "tablet-connect-paper");

      await sheet.getByRole("button", { name: "Connect Workbench" }).click();
      await expect(sheet).toBeHidden();
      await expect(page.getByRole("button", { name: /octo-owner\/workbench/ })).toContainText(
        "Paper · Workbench",
      );
      // It's kept: the page says so after a reload.
      await page.reload();
      await expect(page.getByRole("button", { name: /octo-owner\/workbench/ })).toContainText(
        "Paper · Workbench",
      );
      await request.post("/api/github/sign-out", { data: {} });
    });

    // The owner's own sessions working now are in Sessions, not on Home (#592): Home shows builders.
    test("an approval waiting is a row of Needs you, approved in one tap", async ({
      page,
      request,
    }) => {
      await signIn(request);
      const asks = await request.post("/api/workspaces/workbench/sessions", {
        data: {
          text: "run command: git merge main (for: Bring the reply box up to date)",
          model: { provider: "fake", model: "echo" },
        },
      });
      expect(asks.status()).toBe(201);

      await page.goto(HOME);
      const { needsYou, builders } = blocks(page);
      const approval = needsYou.getByRole("listitem", { name: "Run git merge main?" });
      await expect(approval).toContainText("asked", { timeout: 45_000 });
      await expect(builders.getByRole("listitem")).toHaveCount(0);
      await shot(page, "tablet-home-needs-you");

      await approval.getByRole("button", { name: /^Approve/ }).click();
      await expect(approval).toHaveCount(0);
      await request.post("/api/github/sign-out", { data: {} });
    });

    // #398: a block's size is set by the layout, never by its rows. The Builders board and Needs
    // you keep their shares of the column (#592), full or empty, and rows past that scroll inside.
    test("the Builders board and Needs you keep their shares of the column, however full", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(HOME);
      const { needsYou, builders } = blocks(page);
      const heights = async () => [
        (await builders.boundingBox())?.height ?? 0,
        (await needsYou.boundingBox())?.height ?? 0,
      ];
      await expect(builders).toBeVisible();
      await expect(page.locator("main [data-placeholder]")).toHaveCount(0);
      const [calmBuilders = 0, calmNeeds = 0] = await heights();
      // Three shares to one (Paper, "Tablet · Builders board").
      expect(calmBuilders).toBeGreaterThan(calmNeeds * 2);

      const working: string[] = [];
      for (const name of ["the reply box", "the talk key", "the rail", "the tiles"]) {
        const asks = await request.post("/api/workspaces/workbench/sessions", {
          data: {
            text: `run command: git merge main (for: Bring ${name} up to date)`,
            model: { provider: "fake", model: "echo" },
          },
        });
        expect(asks.status()).toBe(201);
        working.push(((await asks.json()) as { id: string }).id);
      }

      const approvals = needsYou.getByRole("listitem", { name: "Run git merge main?" });
      await expect(approvals.nth(3)).toBeAttached({ timeout: 45_000 });
      await expect(approvals.first()).toBeInViewport({ ratio: 1 });
      const [busyBuilders = 0, busyNeeds = 0] = await heights();
      // Full, the same as when calm: the rows scroll inside, never stretch their block.
      expect(Math.abs(busyBuilders - calmBuilders)).toBeLessThanOrEqual(2);
      expect(Math.abs(busyNeeds - calmNeeds)).toBeLessThanOrEqual(2);
      await shot(page, "tablet-home-fixed-blocks");

      for (const id of working)
        await request.post(`/api/sessions/${id}/stop`, { data: { turn: 1 } });
      await request.post("/api/github/sign-out", { data: {} });
    });
  });

  test.describe("on the cover screen", () => {
    test.use({ viewport: { width: 400, height: 900 }, hasTouch: true, isMobile: true });

    test("Home is one column in the same order, and nothing scrolls sideways", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(HOME);
      const { needsYou, nextUp } = blocks(page);
      await expect(nextUp).toBeVisible();
      const [needsBox, nextBox] = [await needsYou.boundingBox(), await nextUp.boundingBox()];
      expect(nextBox?.y ?? 0).toBeGreaterThan((needsBox?.y ?? 0) + (needsBox?.height ?? 0));
      expect(Math.round(nextBox?.width ?? 0)).toBe(Math.round(needsBox?.width ?? 0));
      expect(await pageScrollsSideways(page)).toBe(false);
      // #398: each block is a fixed height, whatever it holds, the Builders board three rows tall
      // (#592); the page scrolls between them.
      const { builders } = blocks(page);
      const tall = await Promise.all(
        [needsYou, nextUp].map(async (block) => (await block.boundingBox())?.height ?? 0),
      );
      expect(Math.max(...tall) - Math.min(...tall)).toBeLessThanOrEqual(2);
      expect((await builders.boundingBox())?.y ?? 0).toBeLessThan(needsBox?.y ?? 0);
      await shot(page, "cover-home");
      await request.post("/api/github/sign-out", { data: {} });
    });

    test("with five issues ready, Next up has Build, a Then line and Whole roadmap (#532)", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await readyOnly(page, 5);
      await page.goto(HOME);
      const { nextUp } = blocks(page);
      await expect(nextUp.getByRole("region", { name: "Build #197" })).toBeVisible();
      await nextUp.scrollIntoViewIfNeeded();
      await shot(page, "cover-home-five-ready");
      await nextUpIsSlim(page, {
        titles: "One Reply box everywhere · Paste images on the Fold · A later idea 1",
        more: 1,
      });
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await request.post("/api/github/sign-out", { data: {} });
    });

    test("the Roadmap is one column, and nothing scrolls sideways (#532)", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(`${HOME}#roadmap`);
      await roadmapShowsTheOrder(page);
      expect(await pageScrollsSideways(page)).toBe(false);
      await shot(page, "cover-roadmap");
      await request.post("/api/github/sign-out", { data: {} });
    });
  });

  test.describe("building and merging", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    // Before Build below claims #197.
    test("once Build is tapped, Start building and Cancel stay inside its card (#346)", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(HOME);
      await buildButtonsFitTheirCard(page);
      await request.post("/api/github/sign-out", { data: {} });
    });

    test("Build shows the issue and its model first, then starts a session on it", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(HOME);
      const build = blocks(page).nextUp.getByRole("region", { name: "Build #197" });
      await build.getByRole("button", { name: "Build" }).click();
      await expect(build).toContainText("A new session builds it with Fake (echoes you)");
      await expect(build).toContainText("claims it on GitHub");
      await build.getByRole("button", { name: "Start building" }).click();

      await expect(page).toHaveURL(/\/workspaces\/workbench\/sessions\/[\w-]+$/);
      await expect(page.getByRole("list", { name: "Session" })).toContainText(
        'Build issue #197, "The rail on desktop"',
      );
      // It's claimed, so Next up moves on to the next one.
      await page.goto(HOME);
      await expect(blocks(page).nextUp.getByRole("region", { name: "Build #251" })).toBeVisible();
      await request.post("/api/github/sign-out", { data: {} });
    });

    test("Grill shows the issue and its model first, then starts a grilling session on it (#363)", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(HOME);
      const grill = blocks(page).nextUp.getByRole("region", { name: "Grill #117" });
      await grill.getByRole("button", { name: "Grill" }).click();
      await expect(grill).toContainText("A new session grills it with Fake (echoes you)");
      await grill.getByRole("button", { name: "Start grilling" }).click();

      await expect(page).toHaveURL(/\/workspaces\/workbench\/sessions\/[\w-]+$/);
      await expect(page.getByRole("list", { name: "Session" })).toContainText(
        'Grill issue #117, "Sub-agents for code review"',
      );
      await request.post("/api/github/sign-out", { data: {} });
    });

    test("Merge on a pull request ready to merge merges it in one tap", async ({
      page,
      request,
    }) => {
      await signIn(request);
      await page.goto(HOME);
      const ready = blocks(page).needsYou.getByRole("listitem", { name: /Builds take turns/ });
      await ready.getByRole("button", { name: /^Merge/ }).click();
      await expect(ready).toHaveCount(0);
      await request.post("/api/github/sign-out", { data: {} });
    });
  });
});
