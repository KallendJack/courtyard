# documents

A planning workspace's documents (ADR 0020): lists, reads, saves, renames and deletes them.

**Example:** you tap Save as document under a packing list. It becomes `docs/packing-list.md`, one change with
Open and Undo.

- **Uses:** `context-folder/` (each write), `planning-files/`.
- **Used by:** `sessions/` (the document tool, Save as document), `prompts/`, `changes/`, `worker.ts`; in the web
  app, `features/documents/`.

## API

- `GET /api/workspaces/:id/documents`: the list.
- `GET`, `PATCH`, `DELETE /api/workspaces/:id/documents/:slug`: one document.
- Save as document is `sessions/`' `POST /api/sessions/:id/documents`.

## How it works

- Each write is one change through `context-folder/`.
- Save as document's text comes from an answer.
- One turn's document tool keeps what the model has read, so an update to a document it hasn't read, or one changed
  since, is refused.
