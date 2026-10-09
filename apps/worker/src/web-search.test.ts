import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "./providers/fake.ts";
import {
  asOwner,
  codeRepo,
  codeWorkspace,
  followSession,
  startSession,
  testWorker,
} from "./testing.ts";

// Web search (ADR 0019): what a turn searched and read, and its sources, kept in the event log.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

const SEARCHING = [
  "What do Titan's J-hooks cost?",
  "search the web for: Titan T-3 J-hooks price",
  "read page: https://titan.fitness/j-hooks",
  "cite: [T-3 Series J-Hooks | Titan Fitness](https://titan.fitness/j-hooks)",
  "cite: [Titan T-3 review](https://www.garagegymreviews.com/titan-t3)",
].join("\n");

describe("a turn that searches the web", () => {
  it("records each search and page read, then its sources, which a session opened later replays", async () => {
    const request = await asOwner(
      testWorker({ root, providers: [createFakeProvider({ delayMs: 0 })] }),
    );
    const session = await startSession(request, SEARCHING);

    const live = await followSession(request, { sessionId: session.id, until: "turn-completed" });
    const replayed = await followSession(request, {
      sessionId: session.id,
      until: "turn-completed",
    });

    for (const events of [live, replayed]) {
      const shown = events.flatMap((event) =>
        event.type === "activity" || event.type === "sources" ? [event] : [],
      );
      expect(shown).toMatchObject([
        { activity: { kind: "web-searched", query: "Titan T-3 J-hooks price" } },
        {
          activity: {
            kind: "page-read",
            url: "https://titan.fitness/j-hooks",
            site: "titan.fitness",
          },
        },
        {
          type: "sources",
          sources: [
            {
              site: "Titan Fitness",
              title: "T-3 Series J-Hooks",
              url: "https://titan.fitness/j-hooks",
            },
            {
              site: "garagegymreviews.com",
              title: "Titan T-3 review",
              url: "https://www.garagegymreviews.com/titan-t3",
            },
          ],
        },
      ]);
      expect(events.at(-1)?.type).toBe("turn-completed");
    }
  });

  it("searches nothing in a code workspace", async () => {
    const { repo } = await codeRepo(root);
    await codeWorkspace(root, "garage-gym", repo);
    const request = await asOwner(
      testWorker({ root, providers: [createFakeProvider({ delayMs: 0 })] }),
    );
    const session = await startSession(request, SEARCHING);

    const events = await followSession(request, { sessionId: session.id, until: "turn-completed" });

    expect(events.map((event) => event.type)).not.toContain("activity");
    expect(events.map((event) => event.type)).not.toContain("sources");
  });
});
