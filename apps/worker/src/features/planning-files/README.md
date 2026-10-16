# planning-files

What `documents/` and `things/` share.

**Example:** "Packing list" becomes the file name `packing-list.md` in the workspace's folder, and the change note
names that file.

- **Uses:** `context-folder/`, `workspaces/`.
- **Used by:** `documents/`, `things/`.

## API

None of its own; `routes.ts` holds what their routes share.

## How it works

- A planning workspace's folder (or why it has none).
- A file's name from what it's called, a path from the context folder's top and back.
- The change note that names a change's files.
- For their routes (`routes.ts`): the workspace and file a path names, and the answers for the refusals they share.
