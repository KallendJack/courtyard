import { expect, type Locator, type Page, test } from "@playwright/test";

/** Starts a session with `message`; the fake model echoes it back, Markdown and all. */
const ask = async (page: Page, message: string) => {
  await page.goto("/workspaces/garage-gym");
  await page.getByLabel("Message").fill(message);
  await page.getByRole("button", { name: "Start" }).click();
  const session = page.getByRole("list", { name: "Session" });
  await expect(session.locator("[aria-live]").last()).toHaveAttribute("aria-busy", "false");
  return session;
};

/** What's on the clipboard, with line ends as written (Windows' clipboard turns them into \r\n). */
const clipboard = async (page: Page) =>
  (await page.evaluate(() => navigator.clipboard.readText())).replaceAll("\r\n", "\n");

test.describe("copying", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("copies a finished answer's Markdown as it was written, and says so", async ({ page }) => {
    const message = "**Bold** and a [link](https://courtyard.example/rack).";
    const session = await ask(page, message);

    await session.getByRole("button", { name: "Copy answer" }).click();
    expect(await clipboard(page)).toBe(`You said: ${message}`);
    await expect(session.getByRole("status")).toHaveText("Copied");
    // A couple of seconds on, it's back to a copy button.
    await expect(session.getByRole("status")).toBeEmpty({ timeout: 5_000 });
    await expect(session.getByRole("button", { name: "Copy answer" })).toBeVisible();
  });

  test("a code block names its language and copies just its code", async ({ page }) => {
    const code = "def one_rep_max(weight, reps):\n    return round(weight * (1 + reps / 30), 1)";
    const session = await ask(
      page,
      `To work it out:\n\n\`\`\`python\n${code}\n\`\`\`\n\nThat's all.`,
    );

    const block = session.getByRole("figure", { name: "Python" });
    await block.getByRole("button", { name: "Copy code" }).click();
    expect(await clipboard(page)).toBe(code);
    await expect(block.getByRole("status")).toHaveText("Copied");
    await expect(block.getByRole("status")).toBeEmpty({ timeout: 5_000 });
  });
});

/** Every script the page asks for from now on, by file name. */
const watchScripts = (page: Page) => {
  const scripts: string[] = [];
  page.on("request", (request) => {
    const file = new URL(request.url()).pathname.split("/").at(-1) ?? "";
    if (file.endsWith(".js")) scripts.push(file);
  });
  return scripts;
};

const looksOf = (element: Locator) =>
  element.evaluate((token) => {
    const style = getComputedStyle(token);
    return { colour: style.color, italic: style.fontStyle === "italic" };
  });

test("code is coloured by language from the theme, light and dark", async ({ page }) => {
  const scripts = watchScripts(page);
  const highlighter = () => scripts.filter((file) => /highlight|lowlight/.test(file));
  await ask(page, "No code here, just words.");
  expect(highlighter()).toEqual([]);

  const code = 'def volume(sets):\n    # sets, reps and kg\n    return sum(sets) * 30, "kg"';
  const session = await ask(page, `For your log:\n\n\`\`\`py\n${code}\n\`\`\``);
  const block = session.getByRole("figure", { name: "Python" });
  const token = (text: string) => block.locator("span", { hasText: new RegExp(`^${text}$`) });

  // Moorland's colours, deepened to read on white.
  await expect
    .poll(() => looksOf(token("def")))
    .toEqual({ colour: "rgb(106, 63, 110)", italic: false });
  expect(await looksOf(token("volume"))).toEqual({ colour: "rgb(79, 96, 114)", italic: false });
  expect(await looksOf(token("30"))).toEqual({ colour: "rgb(138, 101, 48)", italic: false });
  expect(await looksOf(token('"kg"'))).toEqual({ colour: "rgb(86, 102, 58)", italic: false });
  expect(await looksOf(token("# sets, reps and kg"))).toEqual({
    colour: "rgb(98, 90, 96)",
    italic: true,
  });
  expect(highlighter().length).toBeGreaterThan(0);

  // The workspace colours as they are.
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await looksOf(token("def"))).toEqual({ colour: "rgb(201, 155, 203)", italic: false });
  expect(await looksOf(token("volume"))).toEqual({ colour: "rgb(138, 155, 172)", italic: false });
  expect(await looksOf(token("30"))).toEqual({ colour: "rgb(201, 162, 107)", italic: false });
  expect(await looksOf(token('"kg"'))).toEqual({ colour: "rgb(157, 176, 122)", italic: false });
  expect(await looksOf(token("# sets, reps and kg"))).toEqual({
    colour: "rgb(167, 158, 164)",
    italic: true,
  });
});

test("maths is drawn as formulas, in all three forms, and prices stay text", async ({ page }) => {
  const scripts = watchScripts(page);
  const maths = () => scripts.filter((file) => /katex|maths/i.test(file));
  await ask(page, "It costs £5 or $10, maybe $20 with $$ signs and no formulas.");
  expect(maths()).toEqual([]);

  const session = await ask(
    page,
    [
      "Epley's estimate, \\(w(1 + r/30)\\), holds up to about ten reps:",
      "$$1RM = w\\left(1 + \\frac{r}{30}\\right)$$",
      "Last week's volume:\n\n\\[V = 3 \\times 5 \\times 80\\]",
      "The bar was £5 or $10, and the plates $20.",
    ].join("\n\n"),
  );
  const answer = session.locator("[aria-live]").last();

  await expect(answer.getByRole("math")).toHaveCount(3);
  // `$$…$$` on its own line and `\[…\]` are centred formulas of their own.
  await expect(answer.locator('math[display="block"]')).toHaveCount(2);
  await expect(answer).toContainText("The bar was £5 or $10, and the plates $20.");
  await expect(answer).not.toContainText("\\(");
  await expect(answer).not.toContainText("$$");
  expect(maths().length).toBeGreaterThan(0);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a long formula scrolls sideways, not the page", async ({ page }) => {
    const long = Array.from({ length: 12 }, (_, i) => `${i + 2} \\times 5 \\times 80`).join(" + ");
    const session = await ask(page, `Last week's volume:\n\n$$V = ${long}$$`);
    const formula = session.locator("[aria-live]").last().locator(".katex-display");

    await expect(formula).toBeVisible();
    const sizes = await formula.evaluate((element) => ({
      scrolls: element.scrollWidth > element.clientWidth,
      overflow: getComputedStyle(element).overflowX,
      page: document.documentElement.scrollWidth <= window.innerWidth,
    }));
    expect(sizes).toEqual({ scrolls: true, overflow: "auto", page: true });
  });
});
