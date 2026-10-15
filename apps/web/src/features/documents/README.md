# documents

A workspace's Documents section. The worker's side is
[`documents/`](../../../../worker/src/features/documents/README.md).

**Example:** the Docs tab lists "Packing list"; tapping it opens the document drawn like an answer.

- **Uses:** `features/changes/`.
- **Used by:** `features/planning-home/`, `features/sessions/` (Save as document's note), a document's page.

## Screens

- The Documents section (`documents-section.tsx`).
- A document's page is in `routes/` (`workspaces.$workspaceId.documents.$slug.tsx`), drawn with the answer renderer.

## How it works

- The documents' calls are in `api.ts`.
