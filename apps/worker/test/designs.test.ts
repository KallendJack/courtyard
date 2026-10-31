import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Designs } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakePaperFiles, type FakeBoard } from "../src/integrations/paper/fake.ts";
import {
  asOwner,
  codeRepo,
  codeWorkspace,
  errorOf,
  type Requester,
  removeTestFolder,
  testWorker,
} from "./testing.ts";

// A code workspace's Designs tab (#522): its Paper file's boards, exported through the fake Paper
// and kept in the worker's data, row by row as the file lays them out.

let root: string;
let repo: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  ({ repo } = await codeRepo(root));
});

afterEach(async () => {
  await removeTestFolder(root);
});

const board = (name: string, x: number, y: number, size = [933, 645]): FakeBoard => ({
  id: `${name}-id`.replaceAll(" ", "-"),
  name,
  x,
  y,
  width: size[0] ?? 933,
  height: size[1] ?? 645,
});

/** A file laid out as the house's are: Live and Agreed in sections, Drafts in a grid. */
const PAGES = [
  {
    name: "1 · Live",
    boards: [
      board("Section · Style guide & brand", -760, 0, [600, 80]),
      board("Style guide · Handheld", 0, 0, [1440, 2000]),
      board("Courtyard mark", 1560, 0, [720, 360]),
      board("Section · Home", -760, 3000, [600, 80]),
      board("Built · Cover · Home", 0, 4000, [476, 695]),
      board("Built · Tablet · Home", 0, 3000),
      board("Built · Tablet · Home, many workspaces", 1013, 3000),
      board("Built · Desktop · Home", 0, 5000, [1440, 900]),
    ],
  },
  {
    name: "2 · Agreed",
    boards: [
      board("Section · Code workspace", -760, 0, [600, 80]),
      board("Tablet · Designs: one board full size (#522)", 1070, 0),
      board("Tablet · Designs: Live boards, row by row (#522)", 0, 0),
    ],
  },
  {
    name: "3 · Drafts",
    boards: [
      board("Draft · Tablet · Ended session", 0, 3000),
      board("Audit · Tablet · PRs", 0, 0),
      board("Audit · Cover · PRs", 1000, 0, [476, 695]),
    ],
  },
  { name: "4 · Archive", boards: [board("Tablet · Old Home", 0, 0)] },
];

/** A worker on a clock the test moves, with Side project on the fake Paper's file. */
const designsWorker = async (more: { paper?: boolean; listsAtMost?: number } = {}) => {
  const clock = { now: Date.parse("2026-10-27T09:00:00Z") };
  const paper = createFakePaperFiles({
    boards: { "file-1": PAGES },
    ...(more.listsAtMost === undefined ? {} : { listsAtMost: more.listsAtMost }),
  });
  await codeWorkspace(root, "side-project", repo, {
    name: "Side project",
    ...(more.paper === false
      ? {}
      : { connections: { paper: { command: "/path/to/paper", fileId: "file-1" } } }),
  });
  const request = await asOwner(
    testWorker({ root, paperFiles: paper.paper, now: () => clock.now }),
  );
  return { clock, paper, request };
};

const designsOf = async (request: Requester) => {
  const response = await request("/api/workspaces/side-project/designs");
  expect(response.status).toBe(200);
  return Designs.parse(await response.json());
};

/** The designs once the export the visit started has finished. */
const exported = async (request: Requester) => {
  await expect.poll(async () => (await designsOf(request)).exporting).toBe(false);
  return designsOf(request);
};

/** Each page's rows, as area and board labels. */
const rowsOf = (designs: Designs) =>
  Object.fromEntries(
    designs.pages.map((page) => [
      page.kind,
      {
        count: page.count,
        rows: page.rows.map((row) => [row.area, row.boards.map((each) => each.label)]),
      },
    ]),
  );

describe("the Designs tab (#522)", () => {
  it("exports the file's boards on the first visit, each page row by row as Paper lays it out", async () => {
    const { request } = await designsWorker();

    const first = await designsOf(request);
    expect(first).toMatchObject({ fileId: "file-1", exportedAt: null, exporting: true });

    const designs = await exported(request);
    expect(designs.exportedAt).toBe("2026-10-27T09:00:00.000Z");
    expect(designs.reached).toBe(true);
    expect(rowsOf(designs)).toEqual({
      live: {
        count: 6,
        rows: [
          ["Style guide & brand", ["Style guide · Handheld", "Courtyard mark"]],
          // Desktop, Tablet and Cover left to right.
          ["Home", ["Desktop", "Tablet", "Tablet · Home, many workspaces", "Cover"]],
        ],
      },
      agreed: {
        count: 2,
        rows: [
          [
            "Code workspace",
            [
              "Tablet · Designs: Live boards, row by row (#522)",
              "Tablet · Designs: one board full size (#522)",
            ],
          ],
        ],
      },
      // No sections: its grid's rows, each named by what its boards share.
      drafts: {
        count: 3,
        rows: [
          ["Audit", ["Audit · Tablet · PRs", "Audit · Cover · PRs"]],
          ["Draft", ["Draft · Tablet · Ended session"]],
        ],
      },
    });
    const home = designs.pages[0]?.rows[1]?.boards[0];
    expect(home).toMatchObject({ device: "desktop", width: 1440, height: 900 });
  });

  it("finds every board on a page with more than Paper lists at once", async () => {
    // Paper's get_basic_info lists 100 boards at most; the rest come from the page's tree.
    const { request } = await designsWorker({ listsAtMost: 2 });

    const designs = await exported(request);

    expect(rowsOf(designs).live).toEqual({
      count: 6,
      rows: [
        ["Style guide & brand", ["Style guide · Handheld", "Courtyard mark"]],
        ["Home", ["Desktop", "Tablet", "Tablet · Home, many workspaces", "Cover"]],
      ],
    });
  });

  it("serves each board's picture, which never changes under its name", async () => {
    const { request } = await designsWorker();
    const designs = await exported(request);
    const picture = designs.pages[1]?.rows[0]?.boards[0]?.picture;

    const response = await request(`/api/workspaces/side-project/designs/pictures/${picture}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(await response.text()).toContain("Designs: Live boards, row by row");
    const missing = await request("/api/workspaces/side-project/designs/pictures/0123456789abcdef");
    expect(missing.status).toBe(404);
  });

  it("asks Paper again only once the pictures are a few minutes old", async () => {
    const { clock, paper, request } = await designsWorker();
    await exported(request);
    const asked = paper.asked().length;

    clock.now += 60_000;
    expect((await designsOf(request)).exporting).toBe(false);
    expect(paper.asked()).toHaveLength(asked);

    clock.now += 10 * 60_000;
    expect((await designsOf(request)).exporting).toBe(true);
    await exported(request);
    expect(paper.asked()).toHaveLength(asked + 1);
  });

  it("keeps the last pictures, with their age, while Paper isn't open", async () => {
    const { clock, paper, request } = await designsWorker();
    const before = await exported(request);

    paper.setOpen(false);
    clock.now += 30 * 60_000;
    await designsOf(request);
    const after = await exported(request);

    expect(after.reached).toBe(false);
    expect(after.exportedAt).toBe(before.exportedAt);
    expect(after.pages).toEqual(before.pages);
    const picture = after.pages[0]?.rows[0]?.boards[0]?.picture;
    const response = await request(`/api/workspaces/side-project/designs/pictures/${picture}`);
    expect(response.status).toBe(200);
  });

  it("says so when the workspace has no Paper file", async () => {
    const { request } = await designsWorker({ paper: false });

    const response = await request("/api/workspaces/side-project/designs");

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatch(/no Paper file/);
  });
});
