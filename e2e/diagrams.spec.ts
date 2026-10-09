import { expect, type Page, test } from "@playwright/test";

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
