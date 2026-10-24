# Fabrication: Builds are worked out by code

Decided with the owner on 2026-10-24, after the first real build planned in a planning workspace: a workbench for a
garage. Builds on ADR 0032 (planning workspaces help you do and decide) and leaves room for the sourced Facts
restructure that follows it.

Over two evenings the model wrote three cut lists for the same bench, in prose. One cut six legs from four lengths of
timber, screw sizes changed between versions, and choosing castors meant redoing every length by hand. The owner asked
for "a full parts list and the tools I'm using for each job, with an image of each step, almost like an instruction
manual", and the model couldn't draw one. Wanted parts were saved as Things with nothing but a name: the quantities,
prices and links stayed in the answer. Meanwhile, a design that another AI drafted while Courtyard was at its usage
limit planted tools the owner didn't own and a garage layout wider than the garage.

So:

- **A Build is a design worked out by code.** It is a template (a framed bench or table first, then wall shelving,
  then printed parts) and the parameters the owner and model choose: sizes, the stock it's cut from, the fixings, the
  tools to hand. Code derives everything else from them: the parts, a cut plan for each length and sheet that allows
  for the saw's cut, a buy list with quantities, the build steps, and the 3D view. The model chooses a template, sets
  and explains its parameters and guides the owner one action at a time. It never writes a length, a quantity or a
  total itself.
- **Making rules hold for every Build,** as the house rules hold for every repo. Code enforces what it can: every size a
  Build uses says where it came from (measured, from a maker's page, or assumed); every cut plan allows for the saw's
  cut; a fixing is checked against what it passes through (a bolt long enough for the timber, plate, washers and nut);
  the tools a step needs are checked against the tools the owner has. The rest is in `docs/ai-conduct.md`'s planning
  answers: test-fit one before repeating, measure before buying, and say plainly when a step needs a pro.
- **Where it lives:**
  - The engine, `packages/fabrication`, is plain functions from parameters to a Build's parts, cuts, buy list and
    steps. It knows nothing of the owner, the worker, files or models, so it could ship on its own one day.
  - A planning workspace keeps its Builds as files in its context folder, checked by the contract and saved with Undo
    like Things and projects. A project step can own a Build ("Build the workbench").
  - The worker reads and saves them, and gives planning sessions one tool to create or change a Build.
  - The owner opens a Build in **Fabrication** (`apps/fabrication`): a second web app the same worker serves, behind
    the same login. It shows the chat about the Build, the 3D view, and the build list (cut plan, buy list, steps).
    Like the web app, it holds no state and does no model work. Courtyard links to it from the project.
- **Planning workspaces stay.** Fabrication is what a planning project uses when something gets made; buying, fixing
  and deciding go on as they are.
- **Selling stays possible and isn't decided.** The engine stays free of anything Courtyard-only, and the repo stays
  public under its non-commercial licence. Customers, licensing, their own model keys, a desktop wrapper and printer
  control are a later decision, with their own ADR, once Fabrication has been used for real builds.

## Considered options

- **Keep cut lists in answers and tighten the conduct.** Rejected: the numbers were wrong because a model was adding
  them up, and conduct can't fix arithmetic.
- **A Fabrication view inside the web app.** Workable, and it would share the frame. The owner chose a separate
  interface. The worker, the contract and the records are shared either way, so moving it later costs little.
- **A "fabrication mode" that changes a workspace's whole layout.** Rejected: workspaces differ by their data, never by
  their code. A Build is a record any planning workspace can have.
- **Next.js wrapped in a desktop app, with its own theme, settings files and printer codes, as one brief proposed.**
  Rejected for now:
  - Fabrication uses the web app's stack (Vite, TanStack Router, Tailwind tokens) and its theme.
  - Credentials stay in the worker's settings.
  - A desktop wrapper and printer control wait for the decision to sell.

## Consequences

- **Two new top-level folders**, approved by the owner: `apps/fabrication` and `packages/fabrication`.
- **Fabrication's 3D view brings its first 3D library**, loaded only in Fabrication, never on the web app's first load.
- **Model mistakes in Builds become eval scenarios** checked against the saved Build, not the answer's wording.
- **Next, the restructure:** sourced Facts, spaces and tools as kinds of Thing, and project steps with IDs. After it,
  a Build reads its sizes and tools from those records instead of keeping its own.
