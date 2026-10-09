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

/** A Markdown table, a row per line of cells. */
const markdownTable = (rows: readonly (readonly string[])[]) => {
  const [heading = [], ...body] = rows;
  return [heading, heading.map(() => "---"), ...body]
    .map((cells) => `| ${cells.join(" | ")} |`)
    .join("\n");
};

/** Each row's cell in one column, top to bottom. */
const column = (table: Locator, index: number) =>
  table.locator(`tbody tr td:nth-child(${index + 1})`).allTextContents();

const RACKETS = [
  ["Racket", "Price", "Weight", "Feel"],
  ["Bullpadel Indiga CTR", "£139", "365 g", "Control, kind to the elbow"],
  ["Head Evo Speed", "£95", "360 g", "Light, round, forgiving"],
  ["Adidas Match 3.3", "£149", "360 g", "Teardrop, a bit stiffer"],
  ["Babolat Contact", "£110", "355 g", "Soft foam, big sweet spot"],
];

test.describe("tables", () => {
  test("a table sorts by a column: up, then down, then back as written, prices as numbers", async ({
    page,
  }) => {
    const session = await ask(
      page,
      `Four rackets that suit a soft-arm player:\n\n${markdownTable(RACKETS)}`,
    );
    const table = session.getByRole("table");
    const price = table.getByRole("columnheader", { name: "Price" });
    const asWritten = [
      "Bullpadel Indiga CTR",
      "Head Evo Speed",
      "Adidas Match 3.3",
      "Babolat Contact",
    ];
    expect(await column(table, 0)).toEqual(asWritten);

    await price.getByRole("button").click();
    await expect(price).toHaveAttribute("aria-sort", "ascending");
    expect(await column(table, 1)).toEqual(["£95", "£110", "£139", "£149"]);

    await price.getByRole("button").click();
    await expect(price).toHaveAttribute("aria-sort", "descending");
    expect(await column(table, 1)).toEqual(["£149", "£139", "£110", "£95"]);

    await price.getByRole("button").click();
    await expect(price).not.toHaveAttribute("aria-sort");
    expect(await column(table, 0)).toEqual(asWritten);
  });

  test("dates sort as dates and measures as numbers, text ignores case, and blanks go last", async ({
    page,
  }) => {
    const session = await ask(
      page,
      `The bike's parts:\n\n${markdownTable([
        ["Part", "Bought", "Weight"],
        ["Chain", "9 Oct 2026", "250 g"],
        ["cassette", "Mar 2025", "1,050 g"],
        ["Tyres", "2024-11-02", "980 g"],
        ["Fork", "", "1,850 g"],
      ])}`,
    );
    const table = session.getByRole("table");
    const sortBy = (name: string) =>
      table.getByRole("columnheader", { name }).getByRole("button").click();

    await sortBy("Bought");
    expect(await column(table, 0)).toEqual(["Tyres", "cassette", "Chain", "Fork"]);
    await sortBy("Bought");
    expect(await column(table, 0)).toEqual(["Chain", "cassette", "Tyres", "Fork"]);

    await sortBy("Weight");
    expect(await column(table, 0)).toEqual(["Chain", "Tyres", "cassette", "Fork"]);

    await sortBy("Part");
    expect(await column(table, 0)).toEqual(["cassette", "Chain", "Fork", "Tyres"]);
  });

  test("a table sorted while its answer streams keeps its sort as rows arrive", async ({
    page,
  }) => {
    const prices = [139, 95, 149, 110, 120, 99, 160, 105, 130, 115, 145, 125];
    await page.goto("/workspaces/garage-gym");
    await page
      .getByLabel("Message")
      .fill(
        `Rackets:\n\n${markdownTable([
          ["Racket", "Price"],
          ...prices.map((price, index) => [`Racket number ${index + 1}`, `£${price}`]),
        ])}\n\nThat's the lot.`,
      );
    await page.getByRole("button", { name: "Start" }).click();
    const answer = page.getByRole("list", { name: "Session" }).locator("[aria-live]").last();
    const table = answer.getByRole("table");
    const price = table.getByRole("columnheader", { name: "Price" });

    await price.getByRole("button").click();
    await expect(answer).toHaveAttribute("aria-busy", "true");
    await expect(answer).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
    await expect(price).toHaveAttribute("aria-sort", "ascending");
    expect(await column(table, 1)).toEqual(
      prices.toSorted((a, b) => a - b).map((value) => `£${value}`),
    );
  });
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

  test("a wide table scrolls sideways, not the page, and still sorts", async ({ page }) => {
    const session = await ask(page, `Four rackets:\n\n${markdownTable(RACKETS)}`);
    const table = session.getByRole("table");
    const scroller = table.locator("xpath=../..");

    const sizes = await scroller.evaluate((element) => ({
      scrolls: element.scrollWidth > element.clientWidth,
      overflow: getComputedStyle(element).overflowX,
      page: document.documentElement.scrollWidth <= window.innerWidth,
    }));
    expect(sizes).toEqual({ scrolls: true, overflow: "auto", page: true });

    await table.getByRole("columnheader", { name: "Weight" }).getByRole("button").click();
    expect(await column(table, 2)).toEqual(["355 g", "360 g", "360 g", "365 g"]);
  });
});
