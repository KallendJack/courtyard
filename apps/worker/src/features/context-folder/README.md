# context-folder

The context folder as a git repository: every change to it, one at a time, each kept as a commit you can undo.

**Example:** you say "swapped the chain today". The Things change is one commit saying what kind of change it is,
pushed to the backup, and listed in Recent changes with Undo.

- **Uses:** `owner-context/`, `workspaces/`, and `lib/git.ts`.
- **Used by:** every module that changes the context folder: `saves/`, `documents/`, `things/`, `planning-files/`,
  `changes/`, `connections/`, `fresh-start/`, `sessions/`, `worker.ts`.

## API

- `GET /api/backup` (in `worker.ts`): whether the backup is up to date, for Settings and the home page.

## How it works

- Makes changes one at a time, each kept as a commit that says what kind of change it is.
- Commits hand edits (before the next change and every ten minutes), pushes to the backup, and reads the history
  back for Recent changes and Fresh start.
- A change made file by file rather than line by line (a document's or a Thing's) names its files in
  `Courtyard-File` trailers, so `wholeFilesOf`, `stillAsLeft` and `undoWholeFiles` can read it back and undo it (as
  bytes, so a photo goes back as it was).
- `WHOLE_FILE_FOLDERS` are the workspace folders Recent changes looks in besides `CONTEXT.md`.
