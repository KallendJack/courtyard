import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { shiftsOn } from "./shifts.ts";

// Nothing moves once drawn (#283): each main page, opened on the unfolded Fold and the cover
// screen, loads without the browser reporting a layout shift. Anything that comes in late holds
// its space from the first frame, at its final size (#269, #339, #398).

const signIn = async (request: APIRequestContext) => {
  await request.post("/api/github/sign-in", { data: {} });
  await expect
    .poll(async () => ((await (await request.get("/api/github")).json()) as { kind: string }).kind)
    .toBe("signed-in");
};

const PAGES: {
  name: string;
  path: string;
  ready: (page: Page) => Promise<void>;
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
        await signIn(request);
        const shifts = await shiftsOn(page, each.path, each.ready);
        const total = shifts.reduce((sum, shift) => sum + shift.value, 0);
        expect(total, JSON.stringify(shifts, null, 2)).toBeLessThan(0.001);
        await request.post("/api/github/sign-out", { data: {} });
      });
    }
  });
}
