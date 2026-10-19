import { expect, test } from "@playwright/test";
import { chooseModel, chosen, modelSheet } from "./frame.ts";

// Overflow, on the two fakes: "Fake two" acts out a usage limit, and the session carries on with
// "Fake". Only Fake two is ever sent to its limit, so the other tests' sessions (on Fake) are
// never affected.

test("after a usage limit, Carry on answers with the other provider and a line marks the change", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym#new");
  // By its value: once Fake two is at its limit (on a retry, say), its label says so.
  await chooseModel(page, "fake-two/echo");
  await page.getByLabel("Message", { exact: true }).fill("please hit Fake two's limit");
  await page.getByRole("button", { name: "Start" }).click();

  const notice = page.getByRole("alert").filter({ hasText: "Fake two's usage limit is reached" });
  await expect(notice).toContainText(/It resets (today|tomorrow) at/);
  // The Model sheet labels the model at its limit, and still offers it.
  const sheet = await modelSheet(page);
  await expect(sheet.locator('label:has(input[value="fake-two/echo"])')).toContainText(
    /limit reached, resets/,
  );
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  await notice.getByRole("button", { name: "Carry on with Fake" }).click();

  const session = page.getByRole("list", { name: "Session" });
  await expect(session).toContainText("Now answering: Fake (echoes you), default effort");
  await expect(session).toContainText("You said: please hit Fake two's limit");
  // The limit stays shown on the failed turn, with nothing left to carry on.
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("button")).toHaveCount(0);
  // The session stays on the model it carried on with.
  expect((await chosen(page)).model).toBe("fake/echo");
});

test("a session whose provider shows as unavailable keeps its model, and Send waits for the owner", async ({
  page,
}) => {
  await page.goto("/workspaces/garage-gym#new");
  await chooseModel(page, "fake-two/echo");
  await page.getByLabel("Message", { exact: true }).fill("Which bar for deadlifts?");
  await page.getByRole("button", { name: "Start" }).click();
  const session = page.getByRole("list", { name: "Session" });
  await expect(session).toContainText("You said: Which bar for deadlifts?");

  // Fake two now says it can't be used, as Claude did on a busy machine (#299).
  await page.route("**/api/providers", async (route) => {
    const listed: { providers: { id: string }[] } = await (await route.fetch()).json();
    const providers = listed.providers.map((provider) =>
      provider.id === "fake-two"
        ? {
            id: "fake-two",
            label: "Fake two",
            available: false,
            reason: "Fake two couldn't start on the worker machine.",
          }
        : provider,
    );
    await route.fulfill({ json: { providers } });
  });
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/messages")) {
      sent.push(request.postData() ?? "");
    }
  });
  await page.reload();

  // The rail's Model keeps the session's model, and the line under the box says why it can't send.
  // An unavailable provider's model goes by its own name there.
  await expect(page.getByRole("button", { name: "Model: echo" })).toBeVisible();
  await expect(page.getByText("Fake two isn't available: Fake two couldn't start")).toBeVisible();
  const box = page.getByLabel("Message", { exact: true });
  await box.fill("And which plates?");
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  // Enter doesn't send it to another provider either.
  await box.press("Enter");
  await expect(box).toHaveValue("And which plates?");
  expect(sent).toEqual([]);

  // Switching is only ever the owner's tap.
  await chooseModel(page, "fake/echo");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(session).toContainText("You said: And which plates?");
  expect(sent).toHaveLength(1);
});
