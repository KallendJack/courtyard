import { expect, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";

// Things (ADR 0020): a model's Thing saves as notes under its answer, each with Undo.

test("a model's Thing saves show as notes with what changed, and Undo puts one back", async ({
  page,
}) => {
  await newWorkspace(page, `Mountain biking ${Date.now()}`);
  await startSaving(
    page,
    [
      "thing add: name Whyte T-140 | status have | bought 2026-10 | price £1,400",
      "thing add: name Chain | status have | part of T1",
      "thing T2: bought 2026-10-09 | price £32 | history Swapped, the old one was past 0.75%",
    ].join("\n"),
  );

  const notes = page.getByRole("list", { name: "Things saved" });
  await expect(notes.getByRole("listitem").nth(0)).toContainText(
    "Added ThingWhyte T-140 (have, bought Oct 2026, £1,400)",
  );
  await expect(notes.getByRole("listitem").nth(1)).toContainText(
    "Added ThingChain (have, part of Whyte T-140)",
  );
  const swapped = notes.getByRole("listitem").nth(2);
  await expect(swapped).toContainText("Updated Thing");
  await expect(swapped).toContainText(
    "Chain (bought 9 Oct 2026, £32; history: Swapped, the old one was past 0.75%)",
  );

  await swapped.getByRole("button", { name: "Undo" }).click();
  await expect(swapped).toContainText("Undone");
  await expect(swapped.getByRole("button", { name: "Undo" })).toHaveCount(0);
});
