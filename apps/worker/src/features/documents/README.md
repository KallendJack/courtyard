# documents

A planning workspace's documents (ADR 0020): lists, reads, saves, renames, archives and deletes them.

**Example:** you tap Save as document under a packing list. It becomes `docs/packing-list.md`, one change with
Open and Undo.

- **Uses:** `context-folder/` (each write), `planning-files/`.
- **Used by:** `sessions/` (the document tool, Save as document), `prompts/`, `changes/`, `move-review/` (its
  archive), `fabrication/` (the documents a Build supersedes), `worker.ts`; in the web app, `features/documents/`.

## API

- `GET /api/workspaces/:id/documents`: the list.
- `GET`, `PATCH`, `DELETE /api/workspaces/:id/documents/:slug`: one document.
- Save as document is `sessions/`' `POST /api/sessions/:id/documents`.

## How it works

- Each write is one change through `context-folder/`.
- Save as document's text comes from an answer.
- One turn's document tool (`tool.ts`) keeps what the model has read, so an update to a document it hasn't read, or
  one changed since, is refused.
- **Archiving** (#786): the document tool, given a path and `archive`, moves the document whole to `docs/archive/`
  (the move review's archive), out of the list every turn reads, as one change Undo puts back. It's how the owner's
  one tap on "Archive the old docs" clears a document a Build supersedes.
- **Superseded** (`superseded.ts`, #786): the documents a Build's save says it supersedes, each checked to be there,
  and what changed for its note.
