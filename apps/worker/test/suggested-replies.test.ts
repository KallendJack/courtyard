import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SessionEvent, SessionSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner,
  followSession,
  postJson,
  quotedInGuide,
  removeTestFolder,
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
  await removeTestFolder(root);
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

const REPLIES = ["Weekends", "Weekday evenings"];

/** The answer a turn wrote, without the saving provider's closing "Done.". */
const answerIn = (events: readonly SessionEvent[]) =>
  events
    .flatMap((event) => (event.type === "text-delta" ? [event.text] : []))
    .join("")
    .replace(/\s*Done\.$/, "");

describe("what a model is told once its replies are taken (#127)", () => {
  it("tells a model that has written some of its answer to write only what's missing", async () => {
    const { replies } = await turnSuggesting([
      { write: "Here's the plan. Which days are you free?" },
      suggest(REPLIES),
    ]);

    expect(replies[0]?.reply).toBe(
      await quotedInGuide("The owner sees them as buttons under your answer, with"),
    );
  });

  it("tells one that has written nothing yet to write its whole answer", async () => {
    const { replies } = await turnSuggesting([suggest(REPLIES)]);

    expect(replies[0]?.reply).toBe(
      await quotedInGuide("The owner sees them as buttons under your answer, but"),
    );
  });
});

describe("what a model writes after its replies are taken (#133)", () => {
  it("is dropped where it repeats the answer, so the answer isn't written twice", async () => {
    const question = "Here's the plan. Which days are you free?";
    const { events } = await turnSuggesting([
      { write: question },
      suggest(REPLIES),
      { write: question },
    ]);

    expect(answerIn(events)).toBe(question);
  });

  it("is kept where it's new, such as a recommendation after the question", async () => {
    const { events } = await turnSuggesting([
      { write: "Which days are you free?" },
      suggest(REPLIES),
      { write: "I'd go for weekends: the garage is free then." },
    ]);

    expect(answerIn(events)).toBe(
      "Which days are you free?\n\nI'd go for weekends: the garage is free then.",
    );
  });

  it("is kept where it's new after the answer written again", async () => {
    const { events } = await turnSuggesting([
      { write: "Here's the plan.\nWhich days are you free?" },
      suggest(REPLIES),
      { write: "Here's the plan.\nWhich days" },
      { write: " are you free?\n\nI'd go for weekends." },
    ]);

    expect(answerIn(events)).toBe(
      "Here's the plan.\nWhich days are you free?\n\nI'd go for weekends.",
    );
  });

  it("is dropped where it repeats the answer in other words, so a brief answer stays brief (#613)", async () => {
    // As Claude wrote it in the #599 eval: the step, the replies, then the step again reworded.
    const step =
      "Start by taking the old right-hand pedal off (the chain side). Turn the cranks so that crank points forwards and sits level.\nFit the pedal spanner on the flats of the pedal axle, then push down firmly until it gives. Tell me once it's off.";
    const { events } = await turnSuggesting([
      { write: step },
      suggest(["It's off", "It won't budge"]),
      {
        write:
          "Start with the old right-hand pedal, the one on the chain side. Turn the cranks so that crank points forwards and sits level.\n",
      },
      {
        write:
          "Fit the pedal spanner on the flat part of the pedal axle, then push down firmly until it gives. Tell me when it's off.",
      },
    ]);

    expect(answerIn(events)).toBe(step);
  });

  it("is dropped where it asks the question again in other words, keeping one question (#613)", async () => {
    const question =
      "**Question 1: Where's the garage door, and is the left wall the one on your left as you stand at the door looking in?**\n\n**My recommendation:** the garage door is on one of the 3 m ends, so the left wall is a 5 m long side.";
    const { events } = await turnSuggesting([
      { write: question },
      suggest(["Door on a 3 m end", "Door on a 5 m side"]),
      {
        write:
          '\n\n**Question 1: Where\'s the garage door, and is the "left wall" the one on your left when you stand at the door looking in?**\n\n**My recommendation:** the garage door is on one of the 3 m ends, which makes the left wall a 5 m long side.',
      },
    ]);

    expect(answerIn(events)).toBe(question);
  });

  it("is kept where it's new, though it shares a word or two with the answer (#613)", async () => {
    const { events } = await turnSuggesting([
      { write: "- Work\n- Health\n- Plans\n\nAnything to add or drop?" },
      suggest(["Looks good", "Drop health"]),
      { write: "First, work: are you employed, self-employed, studying or retired?" },
    ]);

    expect(answerIn(events)).toBe(
      "- Work\n- Health\n- Plans\n\nAnything to add or drop?\n\nFirst, work: are you employed, self-employed, studying or retired?",
    );
  });

  it("is kept after a question mark that wasn't a question, such as in a link", async () => {
    const { events } = await turnSuggesting([
      { write: "The plan is at https://gym.example/?week=2." },
      suggest(REPLIES),
      { write: "Which days are you free?" },
    ]);

    expect(answerIn(events)).toBe(
      "The plan is at https://gym.example/?week=2.\n\nWhich days are you free?",
    );
  });
});

describe("a model suggesting replies", () => {
  it("records two or three short replies for the chat to show", async () => {
    const { replies, events } = await turnSuggesting([
      suggest([" The whole floor is mine", "The car stays in winter", "Half: bikes on the left"]),
    ]);

    expect(replies).toEqual([
      {
        ok: true,
        reply: await quotedInGuide("The owner sees them as buttons under your answer, but"),
      },
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

    const short = await quotedInGuide("Each reply is a few words on one line");
    expect(replies).toEqual([
      { ok: false, reply: await quotedInGuide("Suggest two or three", { count: "1" }) },
      { ok: false, reply: await quotedInGuide("Suggest two or three", { count: "4" }) },
      {
        ok: false,
        reply: await quotedInGuide("That input doesn't fit this tool: it takes replies"),
      },
      { ok: false, reply: short },
      { ok: false, reply: short },
      { ok: false, reply: short },
      { ok: false, reply: await quotedInGuide("Two of those replies are the same") },
    ]);
    expect(events.filter((event) => event.type === "suggested-replies")).toEqual([]);
  });

  it("refuses replies once the owner has stopped the turn", async () => {
    const stopped = Promise.withResolvers<void>();
    const called = Promise.withResolvers<void>();
    const saver = savingProvider([
      [() => stopped.promise, suggest(REPLIES), async () => called.resolve()],
    ]);
    const request = await asOwner(testWorker({ root, providers: [saver.provider] }));
    const started = await postJson(request, "/api/workspaces/garage-gym/sessions", {
      text: "Help me plan the garage gym.",
      model: SAVING_MODEL,
    });
    const sessionId = SessionSummary.parse(await started.json()).id;

    await postJson(request, `/api/sessions/${sessionId}/stop`, { turn: 1 });
    stopped.resolve();
    await called.promise;

    expect(saver.replies[0]).toEqual([
      { ok: false, reply: await quotedInGuide("The owner stopped this turn, so no replies") },
    ]);
  });

  it("takes one set per answer", async () => {
    const { replies, events } = await turnSuggesting([
      suggest(["Yes", "No"]),
      suggest(["Maybe", "Later"]),
    ]);

    expect(replies[1]).toEqual({
      ok: false,
      reply: await quotedInGuide("You've already suggested replies"),
    });
    expect(events.filter((event) => event.type === "suggested-replies")).toMatchObject([
      { replies: ["Yes", "No"] },
    ]);
  });
});
