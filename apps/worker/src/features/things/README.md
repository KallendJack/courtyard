# things

A planning workspace's Things (ADR 0020): one file each, `things/<slug>.md`, read, listed and changed.

**Example:** you add "Chain" with a photo. It's one file and its resized photo in one change, with one Undo.

- **Uses:** `context-folder/` (each change), `planning-files/`, `attachments/` (a photo from a turn).
- **Used by:** `sessions/` (the Things tool), `prompts/`, `changes/`, `wanted/` (the Things wanted or to replace),
  `worker.ts`; in the web app, `features/things/`.

## API

- `GET`, `POST /api/workspaces/:id/things`: the list, and Add Thing.
- `GET`, `PUT`, `DELETE /api/workspaces/:id/things/:slug`: one Thing.
- `GET`, `POST /api/workspaces/:id/things/:slug/photo`: its photo.
- `PUT /api/workspaces/:id/things/:slug/pin`: a part's pin, where the owner dragged it on its Thing's photo (#208).

## How it works

- Reads each file against the contract's schema, listing a file that fails with its problem. A Thing bought from
  the wanted list keeps what was paid as its price and where as its shop (#245).
- Lists them with each part after its Thing.
- A part's pin (`pin: 42.5, 61`, across then down, each a percentage of its Thing's photo) and a Thing's `needs`
  (its next step) are kept by the owner's form as they are; a pin goes when its part moves to another Thing or none.
- Adds, changes and removes one as one change through `context-folder/`, its photo with it.
- Keeps a photo resized with `sharp` (`keptPhoto`).
- One turn's Things tool labels the Things as the turn showed them and refuses a change to one changed since.
- Add Thing and Edit send a photo picked in the form with the fields, as one multipart form, so both are one change
  with one Undo. These and the photo's route are the only multipart requests besides a message's
  (`THING_PHOTO_ROUTES`).
