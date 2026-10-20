import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

// Nothing moves once drawn (#283): each main page, opened on the unfolded Fold and the cover
// screen, loads without the browser reporting a layout shift. Anything that comes in late holds
// its space from the first frame, at its final size (#269, #339, #398).

const signIn = async (request: APIRequestContext) => {
  await request.post("/api/github/sign-in", { data: {} });
  await expect
    .poll(async () => ((await (await request.get("/api/github")).json()) as { kind: string }).kind)
    .toBe("signed-in");
};

/**
 * Adds up every layout shift the page reports from the start, outside the owner's own input. Rows
 * coming and going inside a block's own scrolling area are its content, not the page moving (owner
 * on #283: rows appear inside a block's own area, so nothing else moves), so a shift of those
 * alone doesn't count.
 */
const watchShifts = (page: Page) =>
  page.addInitScript(() => {
    const seen: { value: number; sources: string[] }[] = [];
    (window as unknown as { shifts: typeof seen }).shifts = seen;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
        sources?: { node?: Node | null }[];
      }[]) {
        if (entry.hadRecentInput) continue;
        const nodes = (entry.sources ?? []).map((source) => source.node);
        const inBlockRows = (node: Node | null | undefined) =>
          node instanceof Element && node.closest("section li") !== null;
        if (nodes.length > 0 && nodes.every(inBlockRows)) continue;
        const sources = (entry.sources ?? []).map((source) => {
          const node = source.node;
          if (!(node instanceof Element)) return String(node?.nodeName ?? "?");
          const label = node.getAttribute("aria-label") ?? node.textContent?.slice(0, 30) ?? "";
          return `${node.tagName.toLowerCase()}.${node.className.toString().slice(0, 40)} "${label}"`;
        });
        seen.push({ value: entry.value, sources });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });

/** Opens `path`, waits for `ready`, then a moment for anything late, and gives what shifted. */
const shiftsOn = async (page: Page, path: string, ready: (page: Page) => Promise<void>) => {
  await watchShifts(page);
  // As slow as a phone, or CI: what comes in late shows as late as it would there.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await page.goto(path);
  await ready(page);
  await page.waitForTimeout(2500);
  return page.evaluate(
    () => (window as unknown as { shifts: { value: number; sources: string[] }[] }).shifts,
  );
};

const PAGES: {
  name: string;
  path: string;
  ready: (page: Page) => Promise<void>;
  /** What the page is given before it opens, as the worker would give it. */
  given?: (page: Page) => Promise<unknown>;
  /** Still moves, and why, until it's fixed. */
  moves?: string;
}[] = [
  {
    name: "Home",
    path: "/",
    ready: (page) => expect(page.getByRole("heading", { level: 1 })).toBeVisible(),
  },
  {
    name: "a planning workspace",
    path: "/workspaces/garage-gym",
    ready: (page) =>
      expect(page.getByRole("heading", { level: 1, name: "Garage gym" })).toBeVisible(),
  },
  {
    name: "a code workspace",
    path: "/workspaces/side-project",
    ready: (page) => expect(page.getByRole("region", { name: "Next up" })).toBeVisible(),
  },
  {
    // The Builders board loading late (#592): its Lead's builders, as the worker would give them.
    name: "a code workspace with its Builders board",
    path: "/workspaces/toolshed",
    given: (page) =>
      page.route("**/api/workspaces/toolshed/lead", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        const since = new Date(Date.now() - 6 * 60_000).toISOString();
        const builder = (n: number, name: string) => ({
          session: `${n}a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d`,
          title: `Build #4${n}: ${name}`,
          issue: 40 + n,
        });
        await route.fulfill({
          json: {
            state: "running",
            builders: 2,
            building: [builder(1, "Ideas, ranked by value"), builder(2, "Journey book")],
            statuses: [
              { ...builder(1, "Ideas, ranked by value"), status: { kind: "building", since } },
              {
                ...builder(2, "Journey book"),
                status: { kind: "checking", since, command: "pnpm check", ahead: 1 },
              },
              {
                ...builder(3, "Notify me"),
                status: { kind: "ready-for-review", since, pullRequest: 612 },
              },
            ],
            next: [],
            ready: [{ ...builder(3, "Notify me"), pullRequest: 612 }],
            toTidy: 0,
          },
        });
      }),
    ready: (page) =>
      expect(page.getByRole("region", { name: "Builders" })).toContainText("Notify me"),
  },
  {
    name: "a pull request",
    path: "/workspaces/side-project#pr-4",
    ready: (page) => expect(page.getByRole("button", { name: /^Merge/ })).toBeVisible(),
  },
];

for (const [screen, viewport, touch] of [
  ["the unfolded Fold", { width: 950, height: 712 }, true],
  ["the cover screen", { width: 400, height: 900 }, true],
  // The same frame on a computer (#197).
  ["a desktop", { width: 1440, height: 900 }, false],
] as const) {
  test.describe(`on ${screen}`, () => {
    test.use({ viewport, hasTouch: touch, isMobile: touch });
    for (const each of PAGES) {
      test(`${each.name} loads without moving`, async ({ page, request }) => {
        test.fixme(each.moves !== undefined, each.moves);
        await signIn(request);
        await each.given?.(page);
        const shifts = await shiftsOn(page, each.path, each.ready);
        const total = shifts.reduce((sum, shift) => sum + shift.value, 0);
        expect(total, JSON.stringify(shifts, null, 2)).toBeLessThan(0.001);
        await request.post("/api/github/sign-out", { data: {} });
      });
    }
  });
}
