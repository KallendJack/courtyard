# fabrication

Fabrication's Builds, hosted by a planning workspace (#697, ADRs 0036, 0037): one JSON file each,
`builds/<slug>.json`, holding the Build's name, template and parameters, worked out by `packages/fabrication` each
time it's read. And Fabrication's API, which the Fabrication app (#698) calls rather than Courtyard's own routes, so a
standalone Fabrication could answer it with storage of its own.

**Example:** the owner asks for a workbench. The model's Build tool starts "Workbench" from the framed bench's
parameters; the engine works out its parts, cut plan and buy list (total £177.02), the file is one change with one
Undo, and the tool's reply gives the model those numbers to report. "Make it 850 high" changes `height` alone, and the
rest is worked out again.

- **Uses:** `@courtyard/fabrication` (the engine, and the part maker), `@courtyard/builds` (the machine's builds
  lock, for making a printed part), `context-folder/` (each change), `planning-files/`.
- **Used by:** `sessions/` (the Build tool, Undo from its note), `prompts/` (the list, the rule, the tool and its
  reply, `prompts/builds.ts`), `changes/` (Recent changes and Undo); in the web app, `features/fabrication/`; and the
  Fabrication app (`apps/fabrication`).
- **Its chat uses** `sessions/` (list, events, create, send) and `projects/` (which project's step has the Build).

## API

- `GET /api/fabrication/workspaces/:id/builds`: the workspace's Builds by name, and each file that can't be read as
  one with what's wrong. Answers `Builds`.
- `GET /api/fabrication/workspaces/:id/builds/:slug`: one Build with everything derived, where it is (its workspace
  and the project whose step makes it, #698), and how far the owner has got with its steps (#699). Answers
  `BuildOpened`.
- `PUT /api/fabrication/workspaces/:id/builds/:slug/progress`: `BuildProgress`, the step reached and the lines
  ticked (#699); a step the Build doesn't have is refused (400). Answers it as kept.
- `GET /api/fabrication/workspaces/:id/builds/:slug/chat`: its chat (#698), from its project's latest session, or
  else the latest that saved it: what was said and each change saved, and whether an answer is coming. Answers
  `BuildChat`.
- `POST /api/fabrication/workspaces/:id/builds/:slug/chat`: the owner's next message, a `NewMessage` (with photos or
  PDFs, as a form, as a session's take them), into that session, or a new one that belongs to the project. Answers
  `BuildChatSent`, 202.
- `GET /api/fabrication/workspaces/:id/builds/:slug/print`: a printed part made (#702): its size and volume from the
  solid, whether it's watertight, the filament it takes, its triangles for the 3D view and its files' names. Answers
  `MadePart`; 404 for a Build that isn't printed, 422 with each reason when its recipe can't be made, 503 when making
  it runs past its time limit.
- `GET /api/fabrication/workspaces/:id/builds/:slug/print/:file`: its 3MF (`model/3mf`, which Bambu Studio opens) or
  STL (`model/stl`), by the names `MadePart` gives, as a download.
- `GET /api/fabrication/models`: the models the chat can answer with, for its Reply box. Answers `ProviderList`.
- `PATCH /api/fabrication/workspaces/:id/builds/:slug/parameters`: the owner's change to its parameters,
  `BuildParametersChange`, a JSON merge patch (an object merges, `null` takes a value out), worked out before it's
  saved. Answers `BuildChanged`, the change Undo in Recent changes takes back.
- `GET /api/fabrication/tools`: the owner's tools (#707), whether any are saved yet, and each planning workspace's
  Thing that looks like one, to come ticked. Answers `YourTools`.
- `PUT /api/fabrication/tools`: Your tools' Save, `ToolsChange`, every tool the owner has now. Answers `ToolsSaved`.
- `POST /api/fabrication/tools/undo`: `ToolsUndo`, Undo of that Save.
- `POST /api/fabrication/tools/heard`: "Or just say it", `ToolsSaid`. Answers `ToolsHeard`, the tools a model ticked,
  saving nothing; 503 when no model can answer.
- `POST /api/fabrication/workspaces/:id/builds/:slug/stock`: the owner's pick of one of a stock's options (#704),
  `BuildStockPick` (the stock by name, as the buy list gives it, and the option), swapped in every part cut from it.
  Answers `BuildChanged`; an option the stock doesn't have is 400.
- `POST /api/fabrication/workspaces/:id/builds/:slug/changes/:change/undo`: Undo from Fabrication of a change to this
  Build (404 for another's). Answers the Build as it is again, a `BuildView`.

A code workspace keeps none (409). A Build save is undone from its note (`POST /api/sessions/:id/builds/:save/undo`)
or Recent changes.

## How it works

- **The file** (`index.ts`): `{ name, template, parameters }`, nothing derived. A file that isn't JSON, isn't a Build,
  or whose parameters the engine refuses is listed with its problem, never breaking a turn or a list.
- **Saves** (`saveBuild`): a new Build needs its name, template and every parameter; a change merges its parameters
  into the Build's (`parameters.ts`), and a pick swaps a stock through its template's picker. The engine works them
  out first, and parameters it refuses save nothing. Each
  save is one change through `context-folder/`, its note listing each parameter changed ("height: 900 mm → 850
  mm"); Undo (`undoBuildChange`) puts the file back whole, unless it's changed since.
- **Progress** (`progress.ts`, #699): `builds/progress/<slug>.json`, the step reached and the lines ticked, read with
  the Build, and the tool each step started was done with (#777), which the worker works out as lines are ticked
  (never from what's sent), so a started step stays as it was started and its ticks stay on their lines; a file kept
  before then gets the ways the Build's own tools gave. It sits beside the Build's file, so ticking a line never
  stands in the way of undoing a change to the Build. Each write is a `build-progress` change: backed up, never
  listed in Recent changes. The model's list of Builds says the step reached once building has started, so a new
  session carries on there.
- **The tool** (`tool.ts`): one turn's `save_build`, by the labels the turn was shown (`B1`), keeping each file as
  shown or last saved, so a change to one edited since is refused with the Builds as they are now. Given only a
  label, or a change of nothing, it writes nothing and gives the Build as it is, so a later turn reads its numbers
  rather than working them out. Given a project's label and step, `sessions/` gives that step the Build through the
  project tool (`[build: <slug>]` on the step).
- **What a Build is worked out with** (`setting.ts`, #777): besides its parameters, the owner's tools, by name and
  tile, which its steps and pictures follow once they've saved any (its own `tools` until then), and the ways its
  steps started were done. Every read of a Build, the model's and Fabrication's, works it out the same way.
- **The owner's tools** (`tools.ts`, ADR 0037): Things of kind tool in the context folder's own `things/`, so every
  workspace and Build sees the same ones; `sessions/` lists them in every planning turn. A Save writes them all as one
  change: a tool given is written (its count, make and size; a size gives it a subject ID), one not given is removed,
  and a workspace's Thing a tool moves from goes with it, its name, history and photo too (its `tile` kept beside
  a name that isn't the tile's: F-clamps are Clamps). A Thing with parts never moves.
  Undo takes the whole Save back. "Or just say it" is one question to the errand model (`prompts/tools.ts`), each
  tool by a tile's name or the owner's own, once.
- **Printed parts** (`print.ts`, `make-thread.ts`, #702): a printed part's checked recipe is made in a worker thread
  once it has a place in the machine's builds lock (`@courtyard/builds`), and the thread is stopped at
  `COURTYARD_PRINT_TIME_LIMIT_MS` (a minute unless set), or when its JavaScript heap passes
  `COURTYARD_PRINT_MEMORY_LIMIT_MB` (512 unless set), freeing the place. What's made, its 3MF and STL too, is kept
  by the Build's file text, so the page asking again and a download after it make nothing twice; why a recipe
  couldn't be made is kept by the recipe, so asking again is answered at once, without the lock.
- **The chat** (`chat.ts`): which session is the Build's, and its events read as the chat's lines, through
  `sessions/`.
- **The API** (`routes.ts`, and a printed part's in `print-routes.ts`): under `/api/fabrication`, mounted by `worker.ts`, which also serves the Fabrication
  app's files under `/fabrication`.
