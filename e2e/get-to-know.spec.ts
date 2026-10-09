import { expect, test } from "@playwright/test";
import { newWorkspace } from "./saving.ts";

test("an empty workspace offers Get to know, which opens a session with the skill started, until a line is saved", async ({
  page,
}) => {
  const name = `Garden ${Date.now()}`;
  await newWorkspace(page, name);

  await page.getByRole("button", { name: "Get to know this workspace", exact: true }).click();

  const session = page.getByRole("list", { name: "Session" });
  await expect(session.getByText("Skill: Get to know")).toBeVisible();
  await expect(session).toContainText("You said: Get to know this workspace.");
  await expect(page.getByRole("heading", { name: "Get to know this workspace." })).toBeVisible();

  // The owner answers; once a line is saved, the workspace no longer offers it.
  await page.getByLabel("Message").fill("save fact: The garden faces south.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("list", { name: "Saved to context" })).toContainText(
    "The garden faces south.",
  );
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await expect(page.getByRole("region", { name: "Facts" })).toContainText("faces south");
  await expect(
    page.getByRole("button", { name: "Get to know this workspace", exact: true }),
  ).toHaveCount(0);
});
