# fabrication

A planning workspace's Builds in the web app (#697, ADR 0036). For now only the call that undoes a model's Build
save from its note; a Build opens in the Fabrication app (`apps/fabrication`, #698), which calls Fabrication's own
API.

**Example:** the model started the workbench Build. Under its answer, "Started Build · Workbench" offers Undo, which
calls `undoBuildSave`, and the note turns grey.

- **Uses:** `api/worker.ts`.
- **Used by:** `sessions/notes/fabrication.tsx` (the Build and size notes under an answer).

## Calls

- `undoBuildSave(session, save)`: `POST /api/sessions/:id/builds/:save/undo`.
