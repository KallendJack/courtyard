# projects

A planning workspace's projects (#603, ADR 0032): what the owner carries over days and sessions, one file each,
`projects/<slug>.md`, read, started and changed.

**Example:** the owner says they want sockets by the desk in the garage office. The model's project tool adds a step
"[needs a pro] Sockets by the desk · an electrician (Part P)" to `projects/turn-the-garage-into-an-office.md`, one
change with one Undo; Home's Projects lists the office with its next step and Carry on.

- **Uses:** `context-folder/` (each change), `planning-files/`.
- **Used by:** `sessions/` (the project tool, a session's project, Carry on's start), `prompts/` (the list, the
  session's project, the rule and the tool), `planning-home/` (Home's projects), `changes/` (Recent changes and Undo);
  in the web app, `features/projects/`.

## API

- `PUT /api/workspaces/:id/projects/:slug/decision`: Pick on an options block in a session that belongs to the
  project (#603), `ProjectDecision`, recorded as the model's tool records one (a decided step, a history line), the
  owner's own change with Undo in Recent changes. Answers `ProjectDecided`.

Otherwise Home (`GET /api/workspaces/:id/home`) carries the projects, a session starts from one with `project` in its
first message (`POST /api/workspaces/:id/sessions`), and says which it belongs to as `project` (`GET
/api/sessions/:id`), and a project save is undone from its note (`POST /api/sessions/:id/projects/:save/undo`) or
Recent changes. `routes.ts` holds how those answer a refusal.

## How it works

- **The file** (`file.ts`): front matter (name, goal, status `active` or `done`), then `## Steps` (`- [needs a pro]
  Sockets by the desk · an electrician`, and a step that makes a Build ending `[build: workbench]`, #697),
  `## Decisions` (a `###` heading each, then its pick, why and options) and `## History` (dated lines). A file that
  isn't a project as written is listed with its problem, never breaking a turn.
- **What's next** is the first step that isn't decided (`nextStepOf`, in the contract). A step done leaves the steps,
  its history saying "Done: …". A decision about the same thing again replaces the last; its decided step leads the
  list, after those decided already, or takes the place of the step it decides.
- **Saves** (`saveProject`) are one change each through `context-folder/`, its file named in the commit, so Undo
  (`undoProjectChange`) puts the file back whole, unless it's changed since.
- **The tool** (`tool.ts`): one turn's `save_project`, by the labels the turn was shown (`P1`), keeping each file as
  shown or last saved, so a change to one edited since is refused with the projects as they are now; `session`
  attaches the turn's session to the project, which then gets the project's file whole on its turns. `step_build`,
  which the Build tool sends through it rather than the model, gives a step its Build.
