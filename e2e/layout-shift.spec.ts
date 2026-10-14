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

/** Adds up every layout shift the page reports from the start, outside the owner's own input. */
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
  /** Still moves, and why, until it's fixed. */
  moves?: string;
}[] = [
  {
    name: "Home",
    path: "/",
    ready: (page) => expect(page.getByRole("heading", { level: 1 })).toBeVisible(),
    moves: "its foot rows grow the footer when they come (#283: a fixed foot area waits on Paper)",
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
    name: "a pull request",
    path: "/workspaces/side-project#pr-4",
    ready: (page) => expect(page.getByRole("button", { name: /^Merge/ })).toBeVisible(),
  },
];

for (const [screen, viewport] of [
  ["the unfolded Fold", { width: 950, height: 712 }],
  ["the cover screen", { width: 400, height: 900 }],
] as const) {
  test.describe(`on ${screen}`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });
    for (const each of PAGES) {
      test(`${each.name} loads without moving`, async ({ page, request }) => {
        test.fixme(each.moves !== undefined, each.moves);
        await signIn(request);
        const shifts = await shiftsOn(page, each.path, each.ready);
        const total = shifts.reduce((sum, shift) => sum + shift.value, 0);
        expect(total, JSON.stringify(shifts, null, 2)).toBeLessThan(0.001);
        await request.post("/api/github/sign-out", { data: {} });
      });
    }
  });
}
