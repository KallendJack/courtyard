import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { newWorkspace, startSaving } from "./saving.ts";

// Projects (#603, ADR 0032; Paper, "2 · Agreed", planning workspace row: "Tablet · Mountain biking
// Home: the bike, then projects (#603)" and "Tablet · Project: turn the garage into an office
// (#603)"): Home lists each project under the workspace's subject with its next step and Carry
// on; a project's page shows its goal, what's next and its steps; Carry on starts a session that
// belongs to it. The worker's side is in projects.test.ts.

test.use({ viewport: { width: 950, height: 712 }, hasTouch: true, isMobile: true });

/** Where the boards' screenshots go, when a run asks for them (COURTYARD_E2E_SHOTS). */
const shot = async (page: Page, name: string) => {
  const folder = process.env.COURTYARD_E2E_SHOTS;
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
};

/** The fake's line starting a project, with the tool's input as JSON. */
const startProject = (input: object) => `project: ${JSON.stringify(input)}`;

const OFFICE = {
  name: "Turn the garage into an office",
  goal: "Storage at the front, a desk at the back. Budget £200–500.",
  add_steps: [
    {
      who: "you",
      text: "Measure the back wall and the boiler corner",
      detail: "about 10 minutes, laser measurer",
    },
    { who: "you", text: "Pick a desk and chair that fit the back wall" },
    { who: "a pro", text: "Sockets by the desk", detail: "an electrician (Part P)" },
    { who: "a pro", text: "A door through to the house", detail: "a builder, building regs" },
  ],
};

/** The garage split in two, as the board draws it (#710): one step done, a Build, one not ready. */
const SPLIT = [
  startProject({
    name: "Split the garage in two",
    goal: "A bench for the printer and work, storage off the floor. Budget £200–500.",
    add_steps: [
      { who: "you", text: "Order the outdoor storage" },
      {
        who: "you",
        text: "Assemble the storage, clear the garage",
        detail: "about 2 hours, a helper for the doors",
      },
      { who: "you", text: "Build the workbench", detail: "a weekend" },
      { who: "you", text: "Fix shelving to the back wall", needs: ["the wall's construction"] },
      {
        who: "a pro",
        text: "A door through to the shoe cupboard",
        detail: "a builder, and a structural engineer if the wall is block",
      },
    ],
  }),
  startProject({ project: "P1", step: "s1", done: true }),
  startProject({ project: "P1", step: "s3", step_build: "workbench" }),
  startProject({ project: "P1", decision_about: "Bench legs", decision_pick: "4×2 timber" }),
  startProject({ project: "P1", decision_about: "Lower shelf", decision_pick: "18 mm OSB" }),
];

/** Starts the scripted session, waits for its project notes, and goes back to Home. */
const saveAndGoHome = async (page: Page, name: string, lines: readonly string[]) => {
  await startSaving(page, lines.join("\n"));
  await expect(page.getByRole("list", { name: "Projects saved" })).toContainText("Started project");
  await page.getByRole("link", { name: `Back to ${name}` }).click();
};

const projects = (page: Page) => page.getByRole("region", { name: "Projects" });

test("Home lists each project under the bike, with its next step and Carry on", async ({
  page,
}) => {
  const name = `Trail riding ${Date.now()}`;
  await newWorkspace(page, name);
  // The bike with its parts, drawn as Home's subject, then two projects.
  await saveAndGoHome(page, name, [
    "thing add: name Whyte T-140 | status have",
    "thing add: name Pedals | status have | part of T1 | upcoming DMR V8",
    "thing add: name Fork | status have | part of T1",
    startProject({
      name: "Ride red trails with confidence",
      add_steps: [{ who: "you", text: "The cornering drill on Saturday's ride" }],
    }),
    startProject({
      name: "Bike set up right",
      add_steps: [{ who: "you", text: "Fit the DMR V8 pedals when they arrive" }],
    }),
  ]);

  await expect(
    page
      .getByRole("region", { name: "Whyte T-140" })
      .getByRole("link", { name: "Pedals, DMR V8 next" }),
  ).toBeVisible();
  const rows = projects(page).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Bike set up right");
  await expect(rows.first()).toContainText("Next: Fit the DMR V8 pedals when they arrive");
  await expect(rows.nth(1)).toContainText("Next: The cornering drill on Saturday's ride");
  await expect(rows.first().getByRole("button", { name: "Carry on" })).toBeVisible();
  // Calm: no warnings or nudges, only what's next.
  await expect(projects(page)).not.toContainText(/overdue|needs you|!/i);
  await shot(page, "planning-home-projects");
});

test("a project's page shows its goal, what's next and its steps, and Carry on starts a session that belongs to it", async ({
  page,
}) => {
  const name = `Garage ${Date.now()}`;
  await newWorkspace(page, name);
  await saveAndGoHome(page, name, [startProject(OFFICE)]);

  // With no subject yet, the projects are Home.
  await expect(projects(page).getByRole("listitem")).toHaveCount(1);
  await projects(page).getByRole("link", { name: OFFICE.name }).click();

  await expect(page.getByRole("heading", { level: 2, name: OFFICE.name })).toBeVisible();
  await expect(page.getByRole("link", { name: "Projects", exact: true })).toBeVisible();
  await expect(page.getByText(OFFICE.goal)).toBeVisible();
  const next = page.getByRole("region", { name: "Next" });
  await expect(next).toContainText("Measure the back wall and the boiler corner");
  await expect(next).toContainText("You · about 10 minutes, laser measurer");

  await next.getByRole("button", { name: "Carry on" }).click();
  await expect(page.getByRole("list", { name: "Session" })).toContainText(
    "Carry on with Turn the garage into an office: Measure the back wall and the boiler corner.",
  );

  // ‹ Projects leads back to Home.
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await projects(page).getByRole("link", { name: OFFICE.name }).click();
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(projects(page)).toBeVisible();
});

test("a project's steps show done, who does each, a Build, what's not ready yet, and its decisions in one row (#710)", async ({
  page,
}) => {
  const name = `Garage ${Date.now()}`;
  await newWorkspace(page, name);
  await saveAndGoHome(page, name, SPLIT);

  // Home's next step is the first not done.
  await expect(projects(page).getByRole("listitem")).toContainText(
    "Next: Assemble the storage, clear the garage",
  );
  await projects(page).getByRole("link", { name: "Split the garage in two" }).click();

  const next = page.getByRole("region", { name: "Next" });
  await expect(next).toContainText("Assemble the storage, clear the garage");
  await expect(next).toContainText("You · about 2 hours, a helper for the doors");
  const steps = page.getByRole("region", { name: "Steps · 1 of 5 done" });
  const rows = steps.getByRole("listitem");
  await expect(rows).toHaveCount(5);
  const state = (row: number) => rows.nth(row).getByRole("img");
  await expect(state(0)).toHaveAccessibleName("Done");
  await expect(rows.nth(0)).toContainText(/^Order the outdoor storageDone \d{1,2} [A-Z][a-z]{2}$/);
  await expect(state(1)).toHaveAccessibleName("Next");
  await expect(rows.nth(1)).toContainText("Assemble the storage, clear the garageYou");
  await expect(state(2)).toHaveAccessibleName("To do");
  await expect(rows.nth(2)).toContainText(
    "Build the workbenchA Build: workbenchOpen in FabricationYou",
  );
  await expect(rows.nth(2).getByRole("link", { name: "Open in Fabrication" })).toHaveAttribute(
    "href",
    /\/fabrication\/workspaces\/[^/]+\/builds\/workbench$/,
  );
  await expect(state(3)).toHaveAccessibleName("Not ready yet");
  await expect(rows.nth(3)).toContainText("Not ready yet: needs the wall's construction");
  await expect(rows.nth(4)).toContainText(
    "A door through to the shoe cupboardA builder, and a structural engineer if the wall is blockA pro",
  );

  // Decisions fold into one row, which opens to show each.
  const decisions = page.getByRole("button", { name: /^Decisions/ });
  await expect(decisions).toHaveText("Decisions2 made · Bench legs, Lower shelf");
  await expect(decisions).toHaveAttribute("aria-expanded", "false");
  await shot(page, "project-steps");
  await decisions.click();
  await expect(page.getByRole("list", { name: "Decisions" }).getByRole("listitem")).toHaveText([
    "Bench legs4×2 timber",
    "Lower shelf18 mm OSB",
  ]);
});

/** Options for the office's desk, as a model would answer in its session, the fake echoing them. */
const DESKS = [
  "Two that fit the back wall. The Flexispot is the one: you can stand at it.",
  "",
  "```options",
  JSON.stringify({
    about: "Desk",
    options: [
      {
        name: "Flexispot E7",
        price: "about £300",
        shop: "Flexispot",
        link: "https://shop.example/e7",
        why: "Stands up, fits the back wall",
      },
      { name: "IKEA Lagkapten", price: "about £60", why: "Cheapest, sits only" },
    ],
  }),
  "```",
].join("\n");

test("Pick on an options block, in a session that belongs to a project, records its decision", async ({
  page,
}) => {
  const name = `Garage ${Date.now()}`;
  await newWorkspace(page, name);
  await saveAndGoHome(page, name, [startProject(OFFICE)]);
  await projects(page).getByRole("button", { name: "Carry on" }).click();
  const session = page.getByRole("list", { name: "Session" });
  await expect(session).toContainText(/Your turn · finished/);

  await page.getByLabel("Message", { exact: true }).fill(DESKS);
  await page.getByRole("button", { name: "Send" }).click();
  const options = page.getByRole("list", { name: "Options for Desk" });
  await expect(options.getByRole("listitem")).toHaveCount(2);
  // An option with no link shows its price alone.
  await expect(options.getByRole("listitem", { name: "IKEA Lagkapten" })).toContainText(
    "about £60",
  );
  const e7 = options.getByRole("listitem", { name: "Flexispot E7" });
  await e7.getByRole("button", { name: "Pick" }).click();
  await expect(e7).toContainText("Decided");
  await expect(options.getByRole("button", { name: "Pick" })).toHaveCount(1);
  await shot(page, "p3-decision-pick");

  // The project keeps it under Decisions, never as a step (#710).
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await projects(page).getByRole("link", { name: OFFICE.name }).click();
  await expect(page.getByRole("button", { name: /^Decisions/ })).toHaveText(
    "Decisions1 made · Desk",
  );
  await expect(page.getByRole("region", { name: /^Steps/ }).getByRole("listitem")).toHaveCount(4);
});

test("a project save's note opens the project, and Undo takes it back", async ({ page }) => {
  const name = `Shed ${Date.now()}`;
  await newWorkspace(page, name);
  await startSaving(page, startProject(OFFICE));
  const note = page.getByRole("list", { name: "Projects saved" });
  await expect(note).toContainText("Started project");
  await expect(note).toContainText("Turn the garage into an office");
  await expect(note).toContainText("Step: Sockets by the desk (a pro)");
  await shot(page, "project-note");

  await note.getByRole("button", { name: "Undo" }).click();
  await expect(note).toContainText("Undone");
  await page.getByRole("link", { name: `Back to ${name}` }).click();
  await expect(projects(page)).toHaveCount(0);
});
