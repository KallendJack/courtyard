# planning-home

A planning workspace's Home (#208): the views it can show, filled from the workspace's Things, which one shows, its
photo, and the owner's last question with its next steps. Decided here once, so no screen works it out.

**Example:** Mountain biking's bike has a photo and three parts. Home offers "Whyte T-140" (the photo, with the
stretched chain and the soft rear tyre flagged first, the fork a quiet pin) and "Wanted" (lights, about £40). Lights
changed last, so Wanted shows, until you tap the bike, which then stays.

- **Uses:** `things/` (the Things, read), `floor-plans/` (its plan views), `planning-files/routes.ts`, `sessions/` (`lastQuestion`), `lib/files.ts`.
- **Used by:** `worker.ts`; in the web app, `features/planning-home/` once its screens are built.

## API

- `GET /api/workspaces/:id/home`: `PlanningHome`, its views, the one showing, whether it's the owner's pick, the
  workspace's photo and the last question.
- `PUT /api/workspaces/:id/home/showing`: the owner's pick (`HomeViewPick`), refused with 404 for a view that isn't
  there.

## How it works

- **Views** (`homeViews`): a picture for each Thing that isn't a part and has a photo and parts, its parts that need
  something first (flagged), then the rest, each with its pin; then each room's floor plan, saved as its document
  (#257), newest first; then the wanted list once anything is wanted or to replace. A view's `changedAt` is the
  newest of its Things' files, or its plan's document's.
- **Showing:** the owner's pick while that view is there, else the view last changed; a pick whose view has gone is
  passed over, never refused.
- **The pick** is Courtyard's own state, kept in the data folder (`planning-home/<workspace>.json`), not a change to
  the context folder.
- **The photo:** the main Thing's, the one with a photo and the most parts.
- **The question:** the owner's last message in the session they last used (not one the worker sent for them), with
  the suggested replies its answer made, whether it's being answered now, and the model and effort it was asked
  with, which a reply from Home carries on with (#481).
- Code workspaces have none: 409, as their Things do.
