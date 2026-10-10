import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

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

/** Signs in to the fake GitHub, which finishes by itself a couple of seconds later. */
const signIn = async (request: APIRequestContext) => {
  await request.post("/api/github/sign-in", { data: {} });
  await expect
    .poll(
      async () => ((await (await request.get("/api/github")).json()) as { kind: string }).kind,
      { timeout: 15_000 },
    )
    .toBe("signed-in");
};

/** What the fake model does to make a pull request: write talk.md, commit with `subject`, push. */
const makesPullRequest = (line: string, subject: string) =>
  [
    `edit file talk.md: ${line}`,
    "run command: git add talk.md",
    `run command: git commit -m "${subject}"`,
    "run command: git push -u origin HEAD",
  ].join("\n");

/** Starts a code session on the fake that opens a pull request, and waits for it to show. */
const sessionWithPullRequest = async (page: Page, subject: string) => {
  await page.goto("/workspaces/side-project");
  await page.getByLabel("Model").selectOption("fake/echo");
  await page.getByLabel("Message").fill(makesPullRequest("Talk into the message box", subject));
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/workspaces\/side-project\/sessions\//);
  const strip = page.getByRole("region", { name: "Branch and pull request" });
  await expect(strip.getByRole("link", { name: /^PR #\d+/ })).toBeVisible();
  return strip;
};

// Reviewing a session's pull request in Courtyard (#160): on this worker the fake GitHub's e2e
// check runs, passes or fails as each commit's subject says.
test("the owner reviews a session's pull request file by file, asks for a change, and merges it once its checks pass", async ({
  page,
  request,
}) => {
  await signIn(request);
  const strip = await sessionWithPullRequest(page, "Talk into the message box [e2e running]");
  await expect(strip).toContainText("+1 −0 · 1 file");

  await strip.getByRole("link", { name: /^PR #\d+/ }).click();
  const review = page.getByRole("region", { name: "Review" });
  const checks = review.getByRole("list", { name: "Checks" });
  await expect(checks).toContainText("verify passed");
  await expect(checks).toContainText("e2e running");
  const files = review.getByRole("navigation", { name: "Changed files" });
  await expect(files.getByRole("button", { name: /talk\.md/ })).toContainText("+1");
  const diff = review.getByRole("region", { name: "Diff of talk.md" });
  await expect(diff).toContainText("Talk into the message box");
  const merge = review.getByRole("button", { name: "Merge" });
  await expect(merge).toBeDisabled();
  await expect(review).toContainText("Merge waits for e2e to finish.");

  // Asking for changes is a message in the session: its fix goes to the same pull request.
  const message = page.getByRole("textbox", { name: "Message" });
  await expect(message).toHaveAttribute("placeholder", "Ask for changes…");
  await message.fill(makesPullRequest("Hold to talk", "Hold to talk as well [e2e passes]"));
  await page.getByRole("button", { name: "Send" }).click();
  await expect(review).toBeHidden();
  await expect(strip).toContainText("checks passed");

  await strip.getByRole("link", { name: /^PR #\d+/ }).click();
  await expect(diff).toContainText("Hold to talk");
  await expect(merge).toBeEnabled();
  await merge.click();

  await expect(strip).toContainText("merged");
  await expect(page.getByText("Its pull request was merged")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();

  await request.post("/api/github/sign-out", { data: {} });
});

test("the owner closes a session's pull request without merging it, once they've confirmed", async ({
  page,
  request,
}) => {
  await signIn(request);
  const strip = await sessionWithPullRequest(page, "Talk into the message box [e2e running]");
  await strip.getByRole("link", { name: /^PR #\d+/ }).click();
  const review = page.getByRole("region", { name: "Review" });

  await review.getByRole("button", { name: "Close PR" }).click();
  const confirm = page.getByRole("region", { name: /^Close PR #\d+\?$/ });
  await expect(confirm).toContainText("without merging");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();

  await review.getByRole("button", { name: "Close PR" }).click();
  await confirm.getByRole("button", { name: "Close PR" }).click();

  await expect(strip).toContainText("closed");
  await expect(page.getByText("Its pull request was closed")).toBeVisible();

  await request.post("/api/github/sign-out", { data: {} });
});
