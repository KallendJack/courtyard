import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner,
  followSession,
  postJson,
  quotedInGuide,
  SAVING_MODEL,
  type ScriptedStep,
  savingProvider,
  testWorker,
} from "./testing.ts";

// Suggested replies (ADR 0017): a model offers them through the worker, which checks them.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

/** One turn in garage-gym in which the model makes the scripted calls: the replies and events. */
const turnSuggesting = async (steps: readonly ScriptedStep[]) => {
  const saver = savingProvider([steps]);
  const request = await asOwner(testWorker({ root, providers: [saver.provider] }));
  const started = await postJson(request, "/api/workspaces/garage-gym/sessions", {
    text: "Help me plan the garage gym.",
    model: SAVING_MODEL,
  });
  const sessionId = SessionSummary.parse(await started.json()).id;
  const events = await followSession(request, { sessionId, until: "turn-completed" });
  return { replies: saver.replies[0] ?? [], events };
};

const suggest = (replies: unknown) => ({ call: "suggest_replies", input: { replies } });

describe("a model suggesting replies", () => {
  it("records two or three short replies for the chat to show", async () => {
    const { replies, events } = await turnSuggesting([
      suggest([" The whole floor is mine", "The car stays in winter", "Half: bikes on the left"]),
    ]);

    expect(replies).toEqual([
      { saved: true, reply: await quotedInGuide("The owner sees them as buttons") },
    ]);
    expect(events.filter((event) => event.type === "suggested-replies")).toMatchObject([
      {
        replies: ["The whole floor is mine", "The car stays in winter", "Half: bikes on the left"],
      },
    ]);
  });

  it("refuses too few or too many, ones that aren't short, and repeats, saying why", async () => {
    const { replies, events } = await turnSuggesting([
      suggest(["Yes"]),
      suggest(["One", "Two", "Three", "Four"]),
      suggest("Yes or no"),
      suggest(["Yes", ""]),
      suggest(["Yes", "x".repeat(61)]),
      suggest(["Yes", "No,\nnot yet"]),
      suggest(["Not yet", "not  yet"]),
    ]);

    const short = "Each reply is a few words on one line, at most 60 characters.";
    expect(replies).toEqual([
      { saved: false, reply: "Suggest two or three replies, not 1." },
      { saved: false, reply: "Suggest two or three replies, not 4." },
      {
        saved: false,
        reply: "That input doesn't fit this tool: it takes replies, a list of two or three texts.",
      },
      { saved: false, reply: short },
      { saved: false, reply: short },
      { saved: false, reply: short },
      { saved: false, reply: "Two of those replies are the same: make each one different." },
    ]);
    expect(events.filter((event) => event.type === "suggested-replies")).toEqual([]);
  });

  it("takes one set per answer", async () => {
    const { replies, events } = await turnSuggesting([
      suggest(["Yes", "No"]),
      suggest(["Maybe", "Later"]),
    ]);

    expect(replies[1]).toEqual({
      saved: false,
      reply: "You've already suggested replies in this answer.",
    });
    expect(events.filter((event) => event.type === "suggested-replies")).toMatchObject([
      { replies: ["Yes", "No"] },
    ]);
  });
});
