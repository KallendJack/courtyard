# changes

The Recent changes list, with Undo. The worker's side is [`changes/`](../../../../worker/src/features/changes/README.md).

**Example:** you delete a document by mistake. The page shows "Deleted · Undo", and Recent changes lists it too.

- **Uses:** `components/layout/kept.tsx`.
- **Used by:** the Recent changes page (`routes/_app/changes.tsx`), `features/documents/`, `features/things/`.

## Screens

- Recent changes (`recent-changes.tsx`), with its calls (`api.ts`).
- The note a page shows for something just deleted from its own page, with Undo (`just-deleted.tsx`).
