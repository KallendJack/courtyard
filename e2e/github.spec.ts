import { expect, test } from "@playwright/test";

// Signing in to GitHub through Courtyard (#99), against the fake GitHub start-worker.mjs gives the
// worker: its sign-in finishes a couple of seconds after it starts, as entering the code on
// another device would.

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("the owner signs in to GitHub from Connections with a device code, and a code workspace says when it isn't", async ({
  page,
  context,
}) => {
  // GitHub itself is never reached: the page it opens is a stand-in.
  await context.route("https://github.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>GitHub</title>" }),
  );
  const notConnected = page.getByRole("region", { name: "GitHub isn't connected" });
  await page.goto("/workspaces/side-project");
  await expect(notConnected).toContainText("can't push its branch or open a pull request");

  await notConnected.getByRole("link", { name: "Sign in to GitHub" }).click();
  await expect(page).toHaveURL(/\/#connections$/);
  const connections = page.getByRole("region", { name: "Connections" });
  const github = connections.getByRole("listitem", { name: /^GitHub/ });
  await expect(github).toContainText("Not connected");
  await github.getByRole("button", { name: "Sign in to GitHub" }).click();

  await expect(github).toContainText("Waiting for you");
  await expect(github).toContainText("Open github.com/login/device and enter this code");
  await expect(github).toContainText("FAKE-0001");
  const opened = page.waitForEvent("popup");
  await github.getByRole("link", { name: "Copy, open GitHub" }).click();
  expect((await opened).url()).toBe("https://github.com/login/device");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("FAKE-0001");

  // The page carries on by itself once the owner has said yes on GitHub.
  const signedIn = connections.getByRole("listitem", { name: "GitHub · octo-owner" });
  await expect(signedIn).toContainText("courtyard · stacks", { timeout: 15_000 });
  await expect(signedIn).toContainText("Connected");

  await page.goto("/workspaces/side-project");
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await expect(notConnected).toBeHidden();

  await page.goto("/");
  await signedIn.getByRole("button", { name: "Sign out" }).click();
  await expect(github).toContainText("Not connected");
});

// From session to pull request (#172): on this worker the fake GitHub opens a pull request for a
// session branch once it's pushed, and its e2e check fails on every commit.
test("a code session shows its branch and pull request, and a failing check starts a turn to fix it", async ({
  page,
  request,
}) => {
  await request.post("/api/github/sign-in", { data: {} });
  await expect
    .poll(
      async () => ((await (await request.get("/api/github")).json()) as { kind: string }).kind,
      {
        timeout: 15_000,
      },
    )
    .toBe("signed-in");

  await page.goto("/workspaces/side-project");
  await page.getByLabel("Model").selectOption("fake/echo");
  await page
    .getByLabel("Message")
    .fill(
      [
        "edit file talk.md: Talk into the message box",
        "run command: git add talk.md",
        'run command: git commit -m "Talk into the message box"',
        "run command: git push -u origin HEAD",
      ].join("\n"),
    );
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/workspaces\/side-project\/sessions\//);

  const strip = page.getByRole("region", { name: "Branch and pull request" });
  await expect(strip).toContainText(/courtyard\/\w+/);
  await expect(strip.getByRole("link", { name: /^PR #\d+/ })).toBeVisible();
  await expect(strip).toContainText("e2e failed · fixing it");
  // The turn the failed check started opens with it, in its activity.
  const failedCheck = page
    .getByRole("list", { name: "What the model did" })
    .getByRole("listitem")
    .filter({ hasText: "Check e2e failed" });
  await expect(failedCheck).toBeVisible();
  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "You said: The checks on your pull request",
  );
  // Once the fixing turn has ended, the check is still failed: nothing new was pushed.
  await expect(strip).toContainText("e2e failed");
  await expect(strip).not.toContainText("fixing it");

  await page.reload();
  await expect(strip).toContainText("e2e failed");
  await expect(failedCheck).toBeVisible();

  await request.post("/api/github/sign-out", { data: {} });
});
