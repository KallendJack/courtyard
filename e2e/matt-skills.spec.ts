import { expect, test } from "@playwright/test";

// Matt Pocock's skills in every code workspace (#181), from the stand-in for his plugin that
// start-worker.mjs gives the worker, and the setup check's offer, against the fake GitHub.

test("a code workspace lists Matt Pocock's skills, and the picker only those the owner starts", async ({
  page,
}) => {
  await page.goto("/workspaces/side-project");
  const skills = page.getByRole("list", { name: "Skills" });
  await expect(skills.getByRole("listitem").filter({ hasText: "Implement" })).toContainText(
    "Matt Pocock's",
  );
  await expect(skills.getByRole("listitem").filter({ hasText: "Tdd" })).toContainText(
    "Matt Pocock's",
  );

  await page.getByLabel("Message").fill("/");
  const picker = page.getByRole("listbox");
  await expect(picker.getByRole("option", { name: /Implement/ })).toBeVisible();
  await expect(picker.getByRole("option", { name: /Tdd/ })).toHaveCount(0);
});

test("the setup check offers what the repository is missing of Matt's setup, and Allow opens a pull request", async ({
  page,
  request,
}) => {
  await request.post("/api/github/sign-in", { data: {} });
  await expect
    .poll(
      async () => ((await (await request.get("/api/github")).json()) as { kind: string }).kind,
      { timeout: 15_000 },
    )
    .toBe("signed-in");

  await page.goto("/workspaces/side-project");
  const card = page.getByRole("region", { name: "Needs your OK" });
  await expect(card).toContainText("Add Matt's setup to this repo?");
  await expect(card.getByRole("code")).toContainText("docs/agents/issue-tracker.md");
  await expect(card.getByRole("code")).toContainText("The Agent skills section in AGENTS.md");
  await expect(card.getByRole("code")).toContainText("Labels on GitHub: needs-triage");
  await card.getByRole("button", { name: "Allow" }).click();

  const done = page.getByRole("region", { name: "Matt's setup" });
  await expect(done.getByRole("link", { name: /^pull request #\d+$/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await expect(card).toHaveCount(0);

  await request.post("/api/github/sign-out", { data: {} });
});
