# tidy

Asks a model for a shorter context file, and saves the changes the owner ticks.

**Example:** you tap Tidy on a long context file. A model proposes merging two facts and dropping a stale plan; you
tick the merge only, and it's saved as one change.

- **Uses:** `providers/`, `prompts/` (the wording), `context-file/`, `context-folder/`, `workspaces/`.
- **Used by:** `worker.ts`, `fresh-start/` (drops one waiting); in the web app, `features/tidy/`.

## API

- `POST /api/workspaces/:id/tidy`, `POST /api/owner-context/tidy`: ask for one.
- `POST /api/tidies/:id/save`: save the ticked changes.

## How it works

- Holds the proposal in the worker's memory until the owner saves it, then saves the ticked changes as one change.
