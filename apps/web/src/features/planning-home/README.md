# planning-home

A planning workspace's page under its name (#300, #603; Paper, "Tablet · Mountain biking Home: the bike, then
projects (#603)").

**Example:** the Mountain biking workspace opens on Home: Courtyard's drawing of a mountain bike, with the Boardman's
saddle, grips, fork, brakes, drivetrain, pedals and tyres labelled round it, each with a line to its pin, and "Pedals ·
DMR V8 next" in violet; under it the bike's projects, each with its next step and Carry on; then the box. Tap Fork and
its card opens.

- **Uses:** `features/sessions/` (the message box, Start, and History's list), `features/things/` (a part's card),
  `features/projects/` (Home's projects and a project's place), `features/documents/`, `components/drawings/` (the
  mountain bike), `components/workspace/` (its pills). The worker's side is `GET /api/workspaces/:id/home`
  ([`planning-home/`](../../../../worker/src/features/planning-home/README.md)).
- **Used by:** a workspace's page (`routes/_app/workspaces.$workspaceId.index.tsx`), loaded only for a planning one.

## Screens

- **Its header:** the name with its ⋯ (What Courtyard knows, Rename, Change icon, Notify me, Archive) and the pills:
  + New · History · Things · Docs, each tab once it has something, with its count, by the address's hash. The chosen
  pill leads back to Home.
- **Home:** the workspace's main subject in one panel (`home-subject.tsx`), as the worker decides it; under it the
  workspace's projects (`features/projects/`), two rows tall, each with its next step and Carry on; then the box. No
  chat. With projects and no subject, the projects fill Home; with neither, the panel keeps its size with one quiet
  line.
- **The drawn bike** (`home-subject.tsx`, `components/drawings/mountain-bike.tsx`): Courtyard's own drawing, never a
  model's, as big as the panel lets it be and keeping its shape. Each part the worker placed on it has a pin and a
  label linking to its card (`/workspaces/:id/things/:slug`), which says its upcoming replacement when it has one;
  pointed at or focused, its line, pin and strokes light violet. On a small bike, labels that would overlap are pushed
  apart along their row, past the bike into the panel if need be, each line following its label (#657). Parts with no
  place on it are listed under it as labels too. On the cover screen the bike has its pins only, and every part is
  listed under it. The bike's photo is on its card.
- **A room's floor plan** (#257; Paper, "Tablet · Floor plan in an answer (#257)"): drawn by the same rich block as in
  an answer (`components/rich-blocks/floor-plan.tsx`, told it's `OnHome`), its list of things scrolling inside the
  block, which keeps its size. From a tablet up the plan is drawn whole, as big as the block's height lets it be,
  measured before it's painted (#662); on the cover screen it's as wide as the block, which grows with it. A long
  room that would be drawn at least half as big again turned a quarter is turned on Home only, its length across
  the block and its front on the left (#669; Paper, "Tablet · Garage Home: a long room turned to fit"); "Turned to
  fit · tap for full size" opens it the right way up in a card. Answers and documents keep it upright. Its size is
  shown only when the worker has checked it against the space's measured floor (#711, the plan's `measured`).
- **A house's floors** (#670; Paper, "Tablet · House Home: the house floor by floor (#292)" and its Cover board):
  drawn by the same module (`Floors`, loaded only when Home has them), side by side to one scale with each floor's
  name above it and each room's size, nothing written outside their walls and no overall size; on the cover screen
  one floor at a time, as wide as the block, with a Ground | First switch.
- **Draw the garage** (`draw-space.tsx`, #604; Paper, "Tablet · Garage Home: Draw the garage, then projects
  (#604)"): a space with no plan yet, as tall as it needs: a dashed box with its size where the plan will be, "No plan
  of the garage yet", the space's size records it's drawn from, each with its source (#711), and Draw the garage,
  which starts a session with them
  (the contract's `drawSpaceMessage`) and opens it. Stacked on the cover screen.
- **A project** (`#project/<slug>`, #603): its page in Home's place, under the header and pills
  (`features/projects/project-view.tsx`); the box under it starts a session that belongs to the project.
- **The box:** always there; it starts a new session. + New (`#new`) focuses it. A photo or doc from Add goes in it.
- **Add** on the frame's rail: a Thing, a photo or a doc.
- An empty workspace shows only its name, one line and the box.

## How it works

- A stylesheet of its own (`planning-home.css`, holding the pills', Home's and the drawing's classes too), like
  `code-home/`.
- Home comes with the page (`api/workspace-page.ts`), kept for the next visit, and stays fresh the shared way.
