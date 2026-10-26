# things

A planning workspace's Things (ADR 0020): one file each, `things/<slug>.md`, read, listed and changed.

**Example:** you add "Chain" with a photo. It's one file and its resized photo in one change, with one Undo.

- **Uses:** `context-folder/` (each change), `planning-files/`, `attachments/` (a photo from a turn).
- **Used by:** `sessions/` (the Things tool), `prompts/`, `changes/`, `worker.ts`; in the web app, `features/things/`.

## API

- `GET`, `POST /api/workspaces/:id/things`: the list, and Add Thing.
- `GET`, `PUT`, `DELETE /api/workspaces/:id/things/:slug`: one Thing.
- `GET`, `POST /api/workspaces/:id/things/:slug/photo`: its photo.
- `PUT /api/workspaces/:id/things/:slug/mark`: `ThingMark`, `fitted`, which swaps its upcoming one in (#602), the
  one it had going to its history.
- `PUT /api/workspaces/:id/things/:slug/upcoming`: a pick from an answer's options (#602), `ThingUpcoming`, kept as
  the Thing's upcoming one, its history saying "Picked … as upcoming".

## How it works

- Reads each file against the contract's schema, listing a file that fails with its problem. A Thing bought from
  the wanted list keeps what was paid as its price and where as its shop (#245).
- Lists them with each part after its Thing.
- A Thing has a **kind** (ADR 0037): item (a file that doesn't say), space or tool, set by Edit or the Things tool's
  `kind`; a tool can carry a `count` (clamps × 2). The first save that records a size gives it a **subject ID**,
  kept through a rename; a Thing deleted and made again gets a new one. The owner's own tools are Things too, kept
  at the context folder's top by `fabrication/tools.ts`, and so is Your stock (#760), of kind material or fixing,
  kept by `fabrication/stock/`; a workspace's own Things are never those two kinds (`WorkspaceThingKind`).
- A `pin:` line left by Home's photo view, and a `needs:` line (what a Thing needed next, which a project's steps
  hold now), are read past, and go on the Thing's next save (#603).
- Adds, changes and removes one as one change through `context-folder/`, its photo with it.
- Keeps a photo resized with `sharp` (`keptPhoto`).
- A Thing's **upcoming** one (#602) is its `upcoming …` lines: a new name replaces the last whole, and a Thing the
  owner has with one coming is one to replace. Fitted (`fitted` on a save) swaps it in: its name as the brand, its
  price and shop, bought today, had again, and a history line for the one it had ("Fitted DMR V8, replacing Wellgo
  alloy flats (bought 2025-04)"), all one change with one Undo.
- One turn's Things tool labels the Things as the turn showed them and refuses a change to one changed since, and a
  new part whose name ends with that of a part of the same Thing (`oneForEachPlace`: "DMR V8 pedals" beside "Pedals"):
  a new one of a part that's there is upcoming on it.
- Add Thing and Edit send a photo picked in the form with the fields, as one multipart form, so both are one change
  with one Undo. These and the photo's route are the only multipart requests besides a message's
  (`THING_PHOTO_ROUTES`).
