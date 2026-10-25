# changes

Recent changes: lists a file's changes, and undoes one.

**Example:** a model changed a fact yesterday. Recent changes lists it with what it said before, and Undo puts it
back as a new change.

- **Uses:** `context-folder/` (the history), `context-file/`, `documents/`, `things/`, `projects/`, `fabrication/`,
  `saves/`, `sessions/`, `workspaces/`.
- **Used by:** `worker.ts`; in the web app, `features/changes/`.

## API

- `GET /api/workspaces/:id/changes`, `GET /api/owner-context/changes`: the list.
- `POST /api/changes/:id/undo`.

## How it works

- Lists a file's changes from `context-folder/`'s history, and its documents', Things', projects' (#603), Builds'
  (#697) and sizes' (#708).
- Undoes one from that page: a model's document, Thing, project, Build or size save through its session, as a save is
  (`whole-files.ts`, which also puts the owner's own changes back file by file).
