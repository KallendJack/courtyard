# planning-home

A planning workspace's Home (#208, #603): its main subject, which leads it, and its projects. Decided here once, so no
screen works it out.

**Example:** Mountain biking has the Boardman MHT 8.6 with its saddle, pedals (DMR V8 upcoming), tyres and a bottle
cage. Home's subject is the Boardman drawn as a mountain bike: the saddle, pedals and tyres on their places, the
pedals saying DMR V8, and the bottle cage under it, with no place on the drawing.

- **Uses:** `things/` (the Things, read), `floor-plans/` (its rooms' plans), `projects/` (its projects, read),
  `workspaces/` (its name and facts, for a space to draw), `planning-files/routes.ts`.
- **Used by:** `worker.ts`; in the web app, `features/planning-home/`.

## API

- `GET /api/workspaces/:id/home`: `PlanningHome`, its subject (`null` while it has none) and its projects (#603),
  those being carried on first, each with its steps and decisions.

## How it works

- **The drawn bike** (`subjectOf`): each Thing that isn't a part has its fitted parts (any not wanted) placed on the
  mountain bike's drawing. A part named just for a place ("Pedals") has it first; then the rest by the words in their
  names (seatpost or dropper, saddle, grips, fork, brakes, drivetrain or chain or cassette, pedals, a rear or back
  tyre, then any tyre for the front), in list order, one part to a place; a part with no place, or whose place is
  taken, goes under it. A wanted part isn't on the bike, so it's neither drawn nor listed (#603). A Thing with two or more parts placed is drawn; of several, the one with the
  most. Each placed part comes with its upcoming replacement's name (#602).
- **A house's floors** (#670): with no drawn Thing, once two or more of those plans are each a floor's, by their
  room's name ("Ground floor", "First floor"), all of them, lowest first (basement, lower ground, ground, first,
  second, …), each named for its floor ("Ground"), under the workspace's name. Any other room's plan is left out.
- **A space's floor plan:** with neither, the newest document that is a room's plan and nothing else (#257).
- **A space to draw** (`spaceOf`, #604): with neither, a workspace whose facts give a floor's two sides ("5.14 × 2.74
  m", "240cm x 180cm") is a space: named from the workspace ("garage"), its size as first saved ("5.14 m × 2.74 m"),
  and every fact that holds a length with its unit, which Draw the garage starts a session with.
- The places themselves (`BIKE_PLACES`) are the contract's; where each sits on the drawing is the web app's.
- Code workspaces have none: 409, as their Things do.
