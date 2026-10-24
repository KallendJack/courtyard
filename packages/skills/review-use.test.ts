import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reviewUse } from "./review-use/scripts/review-use.ts";

// The Review use skill's script (#606), run on a temporary data folder and context folder with
// invented sessions: what it reads back is the review's sections, which the skill's model judges.

let data: string;
let context: string;

beforeEach(async () => {
  data = await mkdtemp(join(tmpdir(), "courtyard-review-data-"));
  context = await mkdtemp(join(tmpdir(), "courtyard-review-context-"));
});

afterEach(async () => {
  await rm(data, { recursive: true, force: true, maxRetries: 5 });
  await rm(context, { recursive: true, force: true, maxRetries: 5 });
});

const WINDOW = { since: "2026-10-10", until: "2026-10-23" };

const workspace = async (id: string, name: string, mode: "planning" | "code") => {
  await mkdir(join(context, id), { recursive: true });
  await writeFile(join(context, id, "workspace.json"), JSON.stringify({ name, mode }));
};

type Event = { type: string; at: string } & Record<string, unknown>;

const session = async (
  id: string,
  file: { workspaceId: string; title: string } & Record<string, unknown>,
  events: readonly Event[],
) => {
  const folder = join(data, "sessions", id);
  await mkdir(folder, { recursive: true });
  const at = events[0]?.at ?? "2026-10-12T09:00:00.000Z";
  await writeFile(
    join(folder, "session.json"),
    JSON.stringify({ id, createdAt: at, updatedAt: at, ...file }),
  );
  const lines = events.map((event, index) => JSON.stringify({ seq: index + 1, ...event }));
  await writeFile(join(folder, "events.jsonl"), `${lines.join("\n")}\n`);
};

const MODEL = { provider: "claude", model: "claude-sonnet-5-5" };
const said = (at: string, text: string, more: Record<string, unknown> = {}): Event => ({
  type: "owner-message",
  at,
  text,
  model: MODEL,
  ...more,
});
const activity = (at: string, activity: Record<string, unknown>): Event => ({
  type: "activity",
  at,
  activity,
});

describe("the review's sections", () => {
  it("say each workspace's use in the window, and nothing from before it", async () => {
    await workspace("allotment", "Allotment", "planning");
    await session("s-old", { workspaceId: "allotment", title: "Last spring" }, [
      said("2026-09-01T10:00:00.000Z", "What do I sow in March?"),
      { type: "turn-completed", at: "2026-09-01T10:01:00.000Z" },
    ]);
    await session("s-beds", { workspaceId: "allotment", title: "Raised beds" }, [
      said("2026-10-12T09:00:00.000Z", "Grill my raised bed plan", { skill: "grilling" }),
      { type: "context-saved", at: "2026-10-12T09:01:00.000Z", save: { action: "add" } },
      { type: "turn-completed", at: "2026-10-12T09:02:00.000Z" },
      said("2026-10-12T09:05:00.000Z", "Here's the shed", {
        attachments: [{ kind: "photo", id: "a1" }],
      }),
      { type: "context-saved", at: "2026-10-12T09:06:00.000Z", save: { action: "add" } },
      { type: "context-undone", at: "2026-10-12T09:07:00.000Z", save: 5 },
      { type: "turn-completed", at: "2026-10-12T09:08:00.000Z" },
    ]);

    const review = await reviewUse({ data, context, ...WINDOW });

    expect(review).toContain("# Use, 2026-10-10 to 2026-10-23");
    expect(review).toContain(
      [
        "## Workspaces",
        "",
        "| Workspace | Kind | Sessions | Owner messages | Skills started | Attachments | Saves | Undone or edited | Approvals | Denied |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        "| Allotment | planning | 1 | 2 | grilling ×1 | 1 | 2 | 1 | 0 | 0 |",
      ].join("\n"),
    );
    expect(review).not.toContain("March");
  });

  it("quote what the owner said in each session, short, and never what the worker sent", async () => {
    await workspace("bike", "Bike", "planning");
    await workspace("app", "App", "code");
    await session("s-chain", { workspaceId: "bike", title: "Chain wear" }, [
      said("2026-10-14T18:00:00.000Z", `The chain skips under load ${"and rattles ".repeat(20)}`),
      { type: "turn-completed", at: "2026-10-14T18:01:00.000Z" },
      said("2026-10-14T18:03:00.000Z", "No, I don't own a chain checker"),
      { type: "turn-completed", at: "2026-10-14T18:04:00.000Z" },
    ]);
    await session("s-fix", { workspaceId: "app", title: "Fix the menu", branch: "app/fix" }, [
      said("2026-10-15T08:00:00.000Z", "Fix the menu on the phone"),
      { type: "turn-completed", at: "2026-10-15T08:30:00.000Z" },
      said("2026-10-15T09:00:00.000Z", "The checks failed: e2e", {
        checksFailed: { pullRequest: 4, head: "abc", checks: ["e2e"] },
      }),
      { type: "turn-completed", at: "2026-10-15T09:10:00.000Z" },
    ]);

    const review = await reviewUse({ data, context, ...WINDOW });

    expect(review).toContain(
      [
        "## What the owner said",
        "",
        "### Bike",
        "",
        `- Chain wear, 2026-10-14 (2 messages): "The chain skips under load ${"and rattles ".repeat(7)}and…"; "No, I don't own a chain checker"`,
        "",
        "### App",
        "",
        '- Fix the menu, 2026-10-15 (1 message): "Fix the menu on the phone"',
      ].join("\n"),
    );
    expect(review).not.toContain("The checks failed");
  });

  it("count each kind of event and activity, by kind of workspace, most first", async () => {
    await workspace("garden", "Garden", "planning");
    await workspace("app", "App", "code");
    await session("s-pond", { workspaceId: "garden", title: "Pond" }, [
      said("2026-10-16T10:00:00.000Z", "How deep should a wildlife pond be?"),
      activity("2026-10-16T10:00:10.000Z", { kind: "web-searched", query: "wildlife pond depth" }),
      activity("2026-10-16T10:00:20.000Z", { kind: "web-searched", query: "pond liner UK" }),
      activity("2026-10-16T10:00:30.000Z", { kind: "skill-loaded", name: "grilling" }),
      { type: "suggested-replies", at: "2026-10-16T10:01:00.000Z", replies: ["Yes", "No"] },
      { type: "turn-completed", at: "2026-10-16T10:01:10.000Z" },
    ]);
    await session("s-board", { workspaceId: "app", title: "Draw the menu", branch: "app/menu" }, [
      said("2026-10-16T11:00:00.000Z", "Draw the menu"),
      activity("2026-10-16T11:00:10.000Z", { kind: "used-tool", connection: "paper", action: "x" }),
      { type: "turn-completed", at: "2026-10-16T11:05:00.000Z" },
    ]);

    const review = await reviewUse({ data, context, ...WINDOW });

    expect(review).toContain(
      [
        "## Signals",
        "",
        "| Signal | Planning | Code |",
        "| --- | --- | --- |",
        "| turn-completed | 1 | 1 |",
        "| web-searched | 2 | 0 |",
        "| skill loaded: grilling | 1 | 0 |",
        "| suggested-replies | 1 | 0 |",
        "| tool: paper | 0 | 1 |",
      ].join("\n"),
    );
  });

  it("split each builder's time into model work and waiting, from its first message to its merge", async () => {
    await workspace("app", "App", "code");
    const at = (time: string) => `2026-10-18T${time}:00.000Z`;
    const pr = (state: string) => ({ number: 7, state, url: "https://github.com/x/y/pull/7" });
    await session(
      "s-42",
      {
        workspaceId: "app",
        title: "Build #42",
        branch: "app/42",
        byLead: true,
        claim: { issue: 42 },
      },
      [
        said(at("09:00"), "Build #42"),
        activity(at("09:10"), { kind: "waiting-for-build", ahead: 1 }),
        activity(at("09:20"), {
          kind: "ran-command",
          command: "pnpm exec vitest run test/x.test.ts",
        }),
        activity(at("09:30"), { kind: "read-file", path: "src/x.ts" }),
        { type: "approval-requested", at: at("09:40"), ask: {} },
        { type: "approval-answered", at: at("10:10"), approval: 5, answer: "allow" },
        { type: "turn-completed", at: at("10:20") },
        said(at("10:30"), "Carry on", { carriesOn: true }),
        { type: "pull-request", at: at("10:40"), pullRequest: pr("open") },
        { type: "turn-completed", at: at("10:50") },
        said(at("11:00"), "The checks failed", { checksFailed: {} }),
        { type: "turn-failed", at: at("11:10"), reason: { kind: "rate-limited" } },
        said(at("11:40"), "The limit has reset", { afterLimit: true }),
        { type: "turn-completed", at: at("11:50") },
        { type: "pull-request", at: at("12:50"), pullRequest: pr("merged") },
      ],
    );

    const review = await reviewUse({ data, context, ...WINDOW });

    const row = "1 h 10 min | 10 min | 10 min | 30 min | 30 min | 10 min | 1 h 10 min | 1 | 1 |";
    expect(review).toContain(
      [
        "## Builders",
        "",
        "| Builder | Issue | PR | Working | Checking | Waiting its turn | Waiting on you | At the limit | Idle, no PR | PR waiting | Approvals | Carried on |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        `| Build #42 | #42 | #7 | ${row}`,
        `| All builders | 1 | 1 | ${row}`,
        "",
        "Model work (working and checking): 1 h 20 min of 3 h 50 min (35%).",
      ].join("\n"),
    );
  });
});
