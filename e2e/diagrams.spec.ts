import { expect, type Page, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";

// Diagrams (ADR 0021): a `mermaid` block in an answer or a document, drawn by Mermaid, loaded only
// when one is there, with nothing in the diagram able to run script or load anything.

/** Starts a session with `message`; the fake model echoes it back, Markdown and all. */
const ask = async (page: Page, message: string) => {
  await page.goto("/workspaces/garage-gym");
  await page.getByLabel("Message").fill(message);
  await page.getByRole("button", { name: "Start" }).click();
  const answer = page.getByRole("list", { name: "Session" }).locator("[aria-live]").last();
  await expect(answer).toHaveAttribute("aria-busy", "false");
  return answer;
};

/** A message with a `mermaid` block in it, between two lines of text. */
const withDiagram = (diagram: string) =>
  `Check the chain every 500 km:\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n\nThat's the lot.`;

const CHAIN = [
  "flowchart TD",
  "  measure[Measure with a chain checker] --> stretched{How stretched?}",
  "  stretched -->|under 0.5%| keep[Keep riding]",
  "  stretched -->|0.5–0.75%| chain[New chain]",
  "  stretched -->|over 0.75%| both[Chain and cassette]",
].join("\n");

/** Every script the page asks for from now on, by file name. */
const watchScripts = (page: Page) => {
  const scripts: string[] = [];
  page.on("request", (request) => {
    const file = new URL(request.url()).pathname.split("/").at(-1) ?? "";
    if (file.endsWith(".js")) scripts.push(file);
  });
  return scripts;
};

test("a mermaid block is drawn as a diagram, and Mermaid loads only when an answer has one", async ({
  page,
}) => {
  const scripts = watchScripts(page);
  const mermaid = () => scripts.filter((file) => /mermaid|flowDiagram|dagre/i.test(file));
  await ask(page, "Just words, no diagram.");
  expect(mermaid()).toEqual([]);

  const answer = await ask(page, withDiagram(CHAIN));
  const diagram = answer.getByRole("figure", { name: "Diagram", exact: true });
  await expect(diagram.locator("svg")).toBeVisible();
  for (const label of ["How stretched?", "Keep riding", "Chain and cassette", "over 0.75%"])
    await expect(diagram.locator("svg text", { hasText: label })).toBeVisible();
  await expect(answer).toContainText("That's the lot.");
  await expect(answer).not.toContainText("flowchart TD");
  expect(mermaid().length).toBeGreaterThan(0);
});

/** Diagrams Mermaid draws, written to run script or load something, each in a way Mermaid has. */
const HOSTILE = [
  // Its own settings, to turn the strict ones off and load pictures from its styles.
  [
    `%%{init: {"securityLevel": "loose", "htmlLabels": true, "layout": "elk", "flowchart": {"htmlLabels": true}, "themeCSS": ".node rect { fill: url(https://courtyard.example/init-css.png) }", "themeVariables": {"primaryColor": "#ff0000"}}}%%`,
    "flowchart TD",
    '  label["<img src=https://courtyard.example/label.png onerror=alert(1)>"] --> plain[Plain]',
    "  click label call alert(2)",
    '  click plain href "javascript:alert(3)"',
  ].join("\n"),
  // An actor's links and its icon.
  [
    "sequenceDiagram",
    "  participant owner as Owner",
    '  links owner: {"Away": "https://courtyard.example/actor-link", "Script": "javascript:alert(4)"}',
    '  properties owner: {"icon": "https://courtyard.example/actor-icon.png"}',
    "  owner->>owner: Thinks",
  ].join("\n"),
  // Settings in front matter.
  [
    "---",
    "config:",
    "  securityLevel: loose",
    "  htmlLabels: true",
    '  themeCSS: "svg { background: url(https://courtyard.example/front-matter.png) }"',
    "---",
    "flowchart LR",
    '  first["<b onmouseover=alert(5)>First</b>"] --> second[Second]',
    "  click first call alert(6)",
  ].join("\n"),
];

/** Diagrams that load something however they're drawn, so they're shown as written instead. */
const UNDRAWABLE = [
  // A picture as a step: the page loads pictures only from Courtyard, so it can't be drawn.
  [
    "flowchart LR",
    '  pictured@{ img: "https://courtyard.example/image-shape.png", label: "Pictured", pos: "t", w: 60, h: 60, constraint: "on" }',
    "  pictured --> after[After]",
  ].join("\n"),
  // A style naming a picture, which Mermaid can't read.
  [
    "flowchart TD",
    "  styled[Styled] --> plain[Plain]",
    "  style styled fill:url(https://courtyard.example/style.png)",
  ].join("\n"),
];

test("nothing in a diagram can run script or load anything", async ({ page, baseURL }) => {
  // Anything the page sends anywhere but Courtyard itself (a load the page refuses isn't sent).
  const leaks: string[] = [];
  await page.route(
    (url) => !url.href.startsWith(`${baseURL}/`),
    (route) => {
      leaks.push(route.request().url());
      return route.abort();
    },
  );
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });

  const answer = await ask(
    page,
    [...HOSTILE, ...UNDRAWABLE]
      .map((diagram) => `Here:\n\n\`\`\`mermaid\n${diagram}\n\`\`\``)
      .join("\n\n"),
  );
  const diagrams = answer.getByRole("figure", { name: "Diagram", exact: true });
  await expect(diagrams).toHaveCount(HOSTILE.length);
  await expect(answer.locator("figure[aria-busy=true]")).toHaveCount(0);
  await expect(answer.getByRole("figure", { name: /^Couldn't draw this diagram/ })).toHaveCount(
    UNDRAWABLE.length,
  );
  // Its own settings changed nothing: Moorland's colours, not the diagram's.
  await expect(diagrams.first().locator(".node rect").first()).toHaveCSS(
    "fill",
    "rgb(238, 230, 238)",
  );

  // Hovering and clicking every step runs nothing either.
  for (const node of await answer.locator("svg .node, svg .actor").all()) {
    await node.hover({ force: true });
    await node.click({ force: true });
  }
  expect(page.url()).toMatch(/\/sessions\//);

  const found = await answer.evaluate((element) => {
    const svgs = [...element.querySelectorAll('figure svg[id^="diagram-"]')];
    const all = svgs.flatMap((svg) => [svg, ...svg.querySelectorAll("*")]);
    const styles = [
      ...all.map((node) => node.getAttribute("style") ?? ""),
      ...svgs.flatMap((svg) =>
        [...svg.querySelectorAll("style")].map((style) => style.textContent),
      ),
    ];
    return {
      elements: all
        .map((node) => node.localName)
        .filter((name) => ["a", "foreignObject", "image", "img", "script", "use"].includes(name)),
      handlers: all.flatMap((node) =>
        [...node.attributes].map((a) => a.name).filter((name) => name.startsWith("on")),
      ),
      links: all.flatMap((node) =>
        [...node.attributes]
          .filter((a) => /href$/.test(a.name) && !a.value.startsWith("#"))
          .map((a) => a.value),
      ),
      outsideStyles: styles.filter((style) => /url\((?!["']?#)|@import/.test(style ?? "")),
    };
  });
  expect(found).toEqual({ elements: [], handlers: [], links: [], outsideStyles: [] });
  expect(dialogs).toEqual([]);
  expect(leaks).toEqual([]);
});

test("a diagram is drawn in Moorland's colours, and again in dark ones when the device changes", async ({
  page,
}) => {
  const answer = await ask(page, withDiagram(CHAIN));
  const step = answer
    .getByRole("figure", { name: "Diagram", exact: true })
    .locator(".node rect")
    .first();
  // Heather outline on a heather wash.
  await expect(step).toHaveCSS("fill", "rgb(238, 230, 238)");
  await expect(step).toHaveCSS("stroke", "rgb(106, 63, 110)");

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(step).toHaveCSS("fill", "rgb(61, 44, 63)");
  await expect(step).toHaveCSS("stroke", "rgb(142, 94, 147)");
});

test("a document's diagrams are drawn on its page, as in an answer", async ({ page }) => {
  await newWorkspace(page, `Bike ${Date.now()}`);
  await startSaving(page, ["save document", "# Chain checks", "", withDiagram(CHAIN)].join("\n"));
  const notes = page.getByRole("list", { name: "Documents saved" });
  await expect(notes).toContainText("Saved document");
  await notes.getByRole("link", { name: "Open" }).click();

  const diagram = page.getByRole("main").getByRole("figure", { name: "Diagram", exact: true });
  await expect(diagram.locator("svg text", { hasText: "Keep riding" })).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a wide diagram scrolls sideways, not the page, at its own size", async ({ page }) => {
    const steps = Array.from({ length: 8 }, (_, i) => `step${i}[Step number ${i + 1}]`);
    const answer = await ask(page, withDiagram(`flowchart LR\n  ${steps.join(" --> ")}`));
    const diagram = answer.getByRole("figure", { name: "Diagram", exact: true });
    await expect(diagram.locator("svg")).toBeVisible();

    const sizes = await diagram.evaluate((figure) => {
      const svg = figure.querySelector("svg");
      return {
        scrolls: figure.scrollWidth > figure.clientWidth,
        overflow: getComputedStyle(figure).overflowX,
        page: document.documentElement.scrollWidth <= window.innerWidth,
        ownSize: svg?.getBoundingClientRect().width === svg?.viewBox.baseVal.width,
      };
    });
    expect(sizes).toEqual({ scrolls: true, overflow: "auto", page: true, ownSize: true });
  });
});

test("a diagram that can't be drawn shows what the model wrote, and the answer reads on", async ({
  page,
}) => {
  const broken = "flowchart TD\n  measure[Measure --> {{{ stretched";
  const answer = await ask(page, withDiagram(broken));

  const fallback = answer.getByRole("figure", {
    name: "Couldn't draw this diagram, so here's what the model wrote",
  });
  await expect(fallback).toBeVisible();
  await expect(fallback.locator("code")).toHaveText(broken);
  await expect(answer.getByRole("figure", { name: "Diagram", exact: true })).toHaveCount(0);
  await expect(answer).toContainText("That's the lot.");
});
