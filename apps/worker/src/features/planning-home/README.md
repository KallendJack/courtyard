# planning-home

A planning workspace's Home (#208, #565): the views it can show, filled from the workspace's Things, which one shows,
its photo, and the latest session's next steps, which History shows. Decided here once, so no screen works it out.

**Example:** Mountain biking has a bike and a road bike, each with a photo and parts. Home offers "Whyte T-140" (its
photo, the stretched chain and the soft rear tyre flagged first, then the fork) and "Road bike". The road bike changed
last, so it shows, until you tap the Whyte, which then stays.

- **Uses:** `things/` (the Things, read), `floor-plans/` (its plan views), `projects/` (its projects, read),
  `planning-files/routes.ts`, `sessions/` (`lastQuestion`), `lib/files.ts`.
- **Used by:** `worker.ts`; in the web app, `features/planning-home/` once its screens are built.

## API

- `GET /api/workspaces/:id/home`: `PlanningHome`, its views, the one showing, whether it's the owner's pick, the
  workspace's photo, the latest session's last question with its next steps, and its projects (#603), those being
  carried on first, each with its steps and decisions.
- `PUT /api/workspaces/:id/home/showing`: the owner's pick (`HomeViewPick`), refused with 404 for a view that isn't
  there.

## How it works

- **Views** (`homeViews`): the Breakdown view for each Thing that isn't a part and has a photo and parts, its parts
  that need something first (flagged), then the rest, each with its pin; then each room's floor plan, saved as its
  document (#257), newest first. The wanted list is the Things tab's, not a view (#565). A view's `changedAt` is the
  newest of its Things' files, or its plan's document's.
- **Showing:** the owner's pick while that view is there, else the view last changed; a pick whose view has gone is
  passed over, never refused.
- **The pick** is Courtyard's own state, kept in the data folder (`planning-home/<workspace>.json`), not a change to
  the context folder.
- **The photo:** the main Thing's, the one with a photo and the most parts.
- **The question:** the owner's last message in the session they last used (not one the worker sent for them), with
  the suggested replies its answer made, whether it's being answered now, and the model and effort it was asked
  with, which a next step tapped in History carries on with (#481, #565).
- Code workspaces have none: 409, as their Things do.
