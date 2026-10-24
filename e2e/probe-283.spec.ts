import { expect, test } from "@playwright/test";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 950, height: 712 } });

test("probe", async ({ page, request }) => {
  await request.post("/api/github/sign-in", { data: {} });
  await expect
    .poll(async () => ((await (await request.get("/api/github")).json()) as { kind: string }).kind, {
      timeout: 15_000,
    })
    .toBe("signed-in");
  await page.goto("/workspaces/workbench");
  await expect(page.getByRole("region", { name: "Build #197" })).toBeVisible();
  await page.waitForTimeout(2000);
  const sizes = await page.evaluate(() => {
    const panel = document.querySelector("[data-scroll-restoration-id]");
    const box = (name: string) => {
      const found = document.querySelector(`[aria-label="${name}"]`)?.getBoundingClientRect();
      return found ? `${name}: y=${Math.round(found.y)} h=${Math.round(found.height)}` : `${name}: -`;
    };
    return [
      `panel scroll=${panel?.scrollHeight} client=${panel?.clientHeight}`,
      ...["Needs you", "Running", "Next up", "Main", "Workspace tabs"].map(box),
    ];
  });
  console.log(sizes.join("\n"));
  await page.screenshot({ path: "probe-283.png" });
  await request.post("/api/github/sign-out", { data: {} });
});
