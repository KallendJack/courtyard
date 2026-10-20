import { join } from "node:path";
import { type APIRequestContext, expect, type Page } from "@playwright/test";

// What the specs that sign in to the worker's fake GitHub share (github*.spec.ts).

/** Signs in to the fake GitHub, which finishes by itself a couple of seconds later. */
export const signIn = async (request: APIRequestContext) => {
  await request.post("/api/github/sign-in", { data: {} });
  await expect
    .poll(
      async () => ((await (await request.get("/api/github")).json()) as { kind: string }).kind,
      { timeout: 15_000 },
    )
    .toBe("signed-in");
};

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
export const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};
