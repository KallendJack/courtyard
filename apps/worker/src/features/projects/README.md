# projects

A planning workspace's projects (#603, ADR 0032): what the owner carries over days and sessions, one file each,
`projects/<slug>.md`, read, started and changed.

**Example:** the owner says they want sockets by the desk in the garage office. The model's project tool adds a step
"Sockets by the desk · an electrician (Part P)", for a pro, to `projects/turn-the-garage-into-an-office.md`, one
change with one Undo; Home's Projects lists the office with its next step and Carry on.

- **Uses:** `context-folder/` (each change), `planning-files/`.
- **Used by:** `sessions/` (the project tool, a session's project, Carry on's start), `prompts/` (the list, the
  session's project, the rule and the tool), `planning-home/` (Home's projects), `changes/` (Recent changes and Undo);
  in the web app, `features/projects/`.

## API

- `PUT /api/workspaces/:id/projects/:slug/decision`: Pick on an options block in a session that belongs to the
  project (#603), `ProjectDecision`, recorded as the model's tool records one (under Decisions, a history line), the
  owner's own change with Undo in Recent changes. Answers `ProjectDecided`.

Otherwise Home (`GET /api/workspaces/:id/home`) carries the projects, a session starts from one with `project` in its
first message (`POST /api/workspaces/:id/sessions`), and says which it belongs to as `project` (`GET
/api/sessions/:id`), and a project save is undone from its note (`POST /api/sessions/:id/projects/:save/undo`) or
Recent changes. `routes.ts` holds how those answer a refusal.

## How it works

- **The file** (`file.ts`): front matter (name, goal, status `active` or `done`), then `## Steps` (`- [ ] Sockets by the
  desk · an electrician [id: s2] [who: a pro]`, done `- [x] … [done: 2026-10-23]`, one not ready yet `[needs: the
  wall's construction]` until it's known, `[needs: … = brick]`, and one that makes a Build `[build: workbench]`, #697,
  #710),
  `## Decisions` (a `###` heading each, then its pick, why and options) and `## History` (dated lines). A file that
  isn't a project as written is listed with its problem, never breaking a turn; a mistyped Build link is left off
  its step alone, the turn told why. A file from before #710 still reads: `[you can do this]` and `[needs a pro]`
  steps get IDs in order, and its `[decided]` steps are left out, since its decisions say the same.
- **Steps** (`steps.ts`) change by their IDs, which a reorder or a rename keeps: marked done (it stays, ticked, its
  history saying "Done: …"), who, needs and what was found, moved, or added before a step. **What's next** is the
  first step not done (`nextStepOf`, in the contract), "not ready yet" while it needs something unknown
  (`unknownNeedsOf`). A decision is never a step: it's kept under Decisions, one about the same thing again replacing
  the last.
- **Saves** (`saveProject`) are one change each through `context-folder/`, its file named in the commit, so Undo
  (`undoProjectChange`) puts the file back whole, unless it's changed since.
- **The tool** (`tool.ts`): one turn's `save_project`, by the labels the turn was shown (`P1`), keeping each file as
  shown or last saved, so a change to one edited since is refused with the projects as they are now; `session`
  attaches the turn's session to the project, which then gets the project's file whole on its turns. `step_build`,
  which the Build tool sends through it, gives a step its Build; the model sends it empty to clear a step's Build
  once that Build is removed (its start undone, say), which the turn's projects list shows.
