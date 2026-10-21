# move-review

The move review (#603, ADR 0032): once, a planning workspace's guides, Plans and Ideas lines and wanted Things are
proposed as moves into what it keeps now (projects, parts' upcoming ones, one-screen reference, the archive), which
the owner ticks on Home. Nothing moves unticked.

**Example:** Mountain biking has an MTB journey guide, a day one guide and three Plans lines. Its review proposes
"MTB journey guide → a project" (its skills as the steps, a Plans line among them) and "Day one guide → archive". The
owner ticks both and taps Move 2: two changes, each with Undo, and Home is the bike and its projects again.

- **Uses:** `providers/` (`answerOnce`, on the first model with room), `prompts/` (what the model is told, and its
  answer's shape), `context-folder/` (each move, one change), `context-file/` (Plans and Ideas lines), `documents/`,
  `things/`, `projects/`, `planning-files/`, `workspaces/`.
- **Used by:** `planning-home/` (Home carries the review), `changes/` (Recent changes lists each move and undoes it),
  `worker.ts` (written as the worker starts and every 30 minutes); in the web app, `features/move-review/`.

## API

- `POST /api/workspaces/:id/review`: the owner's ticks (`MoveTicks`), answered with what moved and what couldn't
  (`MovesMade`). No ticks leaves everything as it is. `GET /api/workspaces/:id/home` carries the review (`review`).

## How it works

- **Written once** (`index.ts`): the first time a planning workspace has something to move (lines under Plans or
  Ideas, a document, a wanted Thing), one question to the first model with room, given its context file, its
  documents whole, its Things and its projects (docs/ai-conduct.md, The move review). Kept in the data folder,
  `move-reviews/<workspace>.json`, proposed or done; a workspace with nothing to move isn't asked, and one that
  couldn't be had is asked again 30 minutes on.
- **Each move** names what it does: a project started or given steps, documents written again whole, documents
  archived (to `docs/archive/`, out of the documents), parts given an upcoming one, and what it takes away
  (documents, Things with their photos, Plans or Ideas lines, word for word). One that doesn't fit the contract's
  `Move` is left out.
- **Moving** makes each ticked move as one change (`Courtyard-Change: move`, its files named), after checking
  everything it names is still there; one that isn't is left, with why, and the review shows it again. Undo, from
  Recent changes, puts its files back as they were, unless one has changed since.
