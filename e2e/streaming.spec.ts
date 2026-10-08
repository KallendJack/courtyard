import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";

/** Words enough that the fake model takes a few seconds to write them. */
const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i + 1}`).join(" ");

/**
 * Every different text the newest answer shows, frame by frame, until it's whole. Start it before
 * sending, so it sees the first piece.
 */
const watchAnswer = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const seen: string[] = [];
        const look = () => {
          const answers = document.querySelectorAll('[aria-label="Session"] [aria-live]');
          const answer = answers[answers.length - 1];
          const text = answer?.textContent ?? "";
          if (text !== "" && seen.at(-1) !== text) seen.push(text);
          if (answer?.getAttribute("aria-busy") === "false") resolve(seen);
          else requestAnimationFrame(look);
        };
        look();
      }),
  );

/** The texts shown that stop partway through a word of the whole answer. */
const midWord = (seen: readonly string[]) => {
  const whole = seen.at(-1) ?? "";
  return seen.filter(
    (text) =>
      text.length < whole.length && /\S$/.test(text) && /\S/.test(whole.charAt(text.length)),
  );
};

const start = async (page: Page, message: string) => {
  await page.goto("/workspaces/garage-gym");
  await page.getByLabel("Message").fill(message);
  const watching = watchAnswer(page);
  await page.getByRole("button", { name: "Start" }).click();
  return { watching };
};

test("an answer is revealed a little at a time at an even pace, not in lumps", async ({ page }) => {
  const message = `Tell me about ${words(40)}.`;
  const seen = await (await start(page, message)).watching;

  expect(seen.at(-1)).toBe(`You said: ${message}`);
  // The fake sends a word at a time; an even pace shows parts of words in between.
  expect(midWord(seen).length).toBeGreaterThan(5);
  // Text only ever grows: nothing shown is taken back.
  for (const text of seen) expect(seen.at(-1)?.startsWith(text)).toBe(true);
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("an answer shows each piece as it arrives", async ({ page }) => {
    const message = `Tell me about ${words(20)}.`;
    const seen = await (await start(page, message)).watching;

    expect(seen.at(-1)).toBe(`You said: ${message}`);
    expect(midWord(seen)).toEqual([]);
  });
});

test("half-written bold and code show formatted while they stream, never as marks", async ({
  page,
}) => {
  const code = Array.from({ length: 8 }, (_, i) => `const rack${i} = bench + bar;`).join("\n");
  const message = `**${words(12)}** and then:\n\n\`\`\`\n${code}\n\`\`\`\n\nThat's all.`;
  const seen = await (await start(page, message)).watching;

  for (const text of seen) {
    expect(text).not.toContain("*");
    expect(text).not.toContain("`");
  }
  const session = page.getByRole("list", { name: "Session" });
  await expect(session.locator("strong")).toHaveText(words(12));
  await expect(session.locator("pre")).toContainText("const rack7 = bench + bar;");
});

test("reopening a session mid-answer shows what's already written at once", async ({ page }) => {
  const message = `Tell me about ${words(300)}.`;
  const { watching } = await start(page, message);
  // The reload ends the page's watch.
  watching.catch(() => undefined);
  const session = page.getByRole("list", { name: "Session" });
  const answer = session.getByText("You said:");
  await expect(answer).toContainText("word20 ");

  // Watches from the moment the reopened page starts, before the session's events arrive.
  await page.addInitScript(() => {
    const seen: string[] = [];
    Reflect.set(window, "seenAnswers", seen);
    const look = () => {
      const text = document.querySelector('[aria-label="Session"] [aria-live]')?.textContent ?? "";
      if (text !== "" && seen.at(-1) !== text) seen.push(text);
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await page.reload();
  await expect(session).toContainText(`You said: ${message}`, { timeout: 30_000 });

  const seen = z
    .array(z.string())
    .parse(await page.evaluate(() => Reflect.get(window, "seenAnswers")));
  expect(seen[0]).toContain("word20 ");
  // It was still being written when the page reopened.
  expect(seen.length).toBeGreaterThan(1);
});
