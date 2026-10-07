import { expect, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";

test("the owner tidies a context file, unticking one change, and Recent changes shows the tidy", async ({
  page,
}) => {
  const name = `Garage ${Date.now()}`;
  await newWorkspace(page, name);
  // Markers at the ends of lines script the fake's tidy: merge these two, remove this one.
  await startSaving(
    page,
    [
      "save fact: Double garage (merge)",
      "save fact: The garage is 5.4 m by 5.1 m (merge)",
      "save plan: Get a quote for rubber flooring (stale)",
    ].join("\n"),
  );
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await page.getByRole("link", { name: "Tidy", exact: true }).click();

  const proposed = page.getByRole("list", { name: "Proposed changes" });
  await expect(proposed.getByRole("listitem")).toHaveCount(2);
  await proposed.getByRole("checkbox", { name: /Remove from Plans/ }).uncheck();
  await page.getByRole("button", { name: "Save 1 change" }).click();

  const changes = page.getByRole("list", { name: "Recent changes" });
  await expect(changes).toContainText("Tidied");
  await expect(changes).toContainText("Double garage, The garage is 5.4 m by 5.1 m");

  await page.getByRole("link", { name: `Back to ${name}` }).click();
  const file = page.getByRole("main");
  await expect(file).toContainText("Double garage, The garage is 5.4 m by 5.1 m");
  await expect(file).toContainText("Get a quote for rubber flooring (stale)");
  // The session title repeats the first line, so check the second is gone.
  await expect(file).not.toContainText("5.1 m (merge)");
});
