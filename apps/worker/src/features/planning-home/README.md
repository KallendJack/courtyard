# planning-home

A planning workspace's Home (#208, #603): its main subject, which leads it, and its projects. Decided here once, so no
screen works it out.

**Example:** Mountain biking has the Boardman MHT 8.6 with its saddle, pedals (DMR V8 upcoming), tyres and a bottle
cage, each part but the cage with its place. Home's subject is the Boardman drawn as a mountain bike: the saddle,
pedals and tyres on their places, the pedals saying DMR V8, and the bottle cage under it, with no place on the drawing.

- **Uses:** `things/` (the Things, read), `floor-plans/` (its rooms' plans), `projects/` (its projects, read),
  `fabrication/sizes.ts` (its size records, read), `workspaces/` (its name), `planning-files/routes.ts`.
- **Used by:** `worker.ts`; in the web app, `features/planning-home/`.

## API

- `GET /api/workspaces/:id/home`: `PlanningHome`, its subject (`null` while it has none) and its projects (#603),
  those being carried on first, each with its steps and decisions.

## How it works

- **The drawn bike** (`subjectOf`): each Thing that isn't a part has its fitted parts (any not wanted) placed on the
  mountain bike's drawing, each on the `place` saved on it (#711), in list order, one part to a place. A part saved
  before places were, with none, still goes on a free place by its name, so a bike drawn before stays drawn until
  the model gives its parts places: one named just for a place ("Pedals") first, then by the words in its name
  (seatpost or dropper, saddle, grips, fork, brakes, drivetrain or chain or cassette, pedals, a rear or back tyre,
  then any tyre for the front). A part with no place, or whose place another has, goes under it. A wanted part isn't
  on the bike, so it's neither drawn nor listed (#603). A Thing with two or more parts placed is drawn; of several, the
  one with the most. Each placed part comes with its upcoming replacement's name (#602).
- **A house's floors** (#670): with no drawn Thing, once two or more of those plans are each a floor's, by their
  room's name ("Ground floor", "First floor"), all of them, lowest first (basement, lower ground, ground, first,
  second, …), each named for its floor ("Ground"), under the workspace's name. Any other room's plan is left out.
- **A space's floor plan:** with neither, the newest document that is a room's plan and nothing else (#257),
  checked against its space's floor as recorded (`records.ts`, #711): the space with the plan's room's name, or the
  only one with a floor. Its size is shown as measured only when it's the size measured or specified, either way
  round, to 2 cm (`check: measured`); drawn as unmeasured when that size is only reported or estimated
  (`unmeasured`); and flagged, drawn as unmeasured, when it differs (`differs`, with the size recorded). With no floor
  recorded it's as drawn, with no `check`, as a plan saved before records were reads.
- **A space to draw** (`records.ts`, #604, #711): with neither, the first space Thing whose standing records give its
  `floor length` and `floor width`, one value each (two that differ give none, since nothing wins on its own): named
  from the space ("garage"), its size in metres, length first ("5.14 m × 2.74 m"), and each of its standing records
  with its source, in the unit it was recorded in
  ("Floor length 5140 mm, measured"), which Draw the garage starts a session with. Nothing is read from a sentence.
- The places themselves (`BIKE_PLACES`) are the contract's; where each sits on the drawing is the web app's.
- Code workspaces have none: 409, as their Things do.
