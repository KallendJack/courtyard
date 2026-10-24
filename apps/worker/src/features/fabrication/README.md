# fabrication

Fabrication's Builds, hosted by a planning workspace (#697, ADRs 0036, 0037): one JSON file each,
`builds/<slug>.json`, holding the Build's name, template and parameters, worked out by `packages/fabrication` each
time it's read. And Fabrication's API, which the Fabrication app (#698) calls rather than Courtyard's own routes, so a
standalone Fabrication could answer it with storage of its own.

**Example:** the owner asks for a workbench. The model's Build tool starts "Workbench" from the framed bench's
parameters; the engine works out its parts, cut plan and buy list (total £172.06), the file is one change with one
Undo, and the tool's reply gives the model those numbers to report. "Make it 850 high" changes `height` alone, and the
rest is worked out again.

- **Uses:** `@courtyard/fabrication` (the engine), `context-folder/` (each change), `planning-files/`.
- **Used by:** `sessions/` (the Build tool, Undo from its note), `prompts/` (the list, the rule, the tool and its
  reply, `prompts/builds.ts`), `changes/` (Recent changes and Undo); in the web app, `features/fabrication/`.

## API

- `GET /api/fabrication/workspaces/:id/builds`: the workspace's Builds by name, and each file that can't be read as
  one with what's wrong. Answers `Builds`.
- `GET /api/fabrication/workspaces/:id/builds/:slug`: one Build with everything derived. Answers `BuildView`.
- `PATCH /api/fabrication/workspaces/:id/builds/:slug/parameters`: the owner's change to its parameters,
  `BuildParametersChange`, a JSON merge patch (an object merges, `null` takes a value out), worked out before it's
  saved. Answers `BuildChanged`, the change Undo in Recent changes takes back.

A code workspace keeps none (409). A Build save is undone from its note (`POST /api/sessions/:id/builds/:save/undo`)
or Recent changes.

## How it works

- **The file** (`index.ts`): `{ name, template, parameters }`, nothing derived. A file that isn't JSON, isn't a Build,
  or whose parameters the engine refuses is listed with its problem, never breaking a turn or a list.
- **Saves** (`saveBuild`): a new Build needs its name, template and every parameter; a change merges its parameters
  into the Build's (`parameters.ts`). The engine works them out first, and parameters it refuses save nothing. Each
  save is one change through `context-folder/`, its note listing each parameter changed ("height: 900 mm → 850
  mm"); Undo (`undoBuildChange`) puts the file back whole, unless it's changed since.
- **The tool** (`tool.ts`): one turn's `save_build`, by the labels the turn was shown (`B1`), keeping each file as
  shown or last saved, so a change to one edited since is refused with the Builds as they are now. Given only a
  label, or a change of nothing, it writes nothing and gives the Build as it is, so a later turn reads its numbers
  rather than working them out. Given a project's label and step, `sessions/` gives that step the Build through the
  project tool (`[build: <slug>]` on the step).
- **The API** (`routes.ts`): under `/api/fabrication`, mounted by `worker.ts`.
