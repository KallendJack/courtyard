# floor-plans

Floor plans Courtyard draws itself (#257): a model describes a room as data in a `plan` block (the contract's
`FloorPlan`), the web app draws it to scale, and this keeps each room's last plan as a document of its own (ADR 0020),
which Home shows.

**Example:** you ask the Garage workspace to draw the garage with a workshop at the front. The answer ends with a plan
of the garage; the moment it ends, it's saved as `docs/garage-floor-plan.md` ("Save floor plan: Garage", with a note
and Undo under the answer), and Home offers "Garage plan". Ask to move the bench and the redrawn plan replaces it
("Update floor plan: Garage").

- **Uses:** `documents/` (`putDocument`, `listDocuments`, `getDocument`), `planning-files/`.
- **Used by:** `sessions/` (saves the plans in each finished answer in a planning workspace), `planning-home/` (its
  plan views); in the web app, `components/rich-blocks/floor-plan.tsx` draws them.

## API

None of its own: a saved plan is a document (`/api/workspaces/:id/documents`), and Home's plan views come in
`GET /api/workspaces/:id/home`.

## How it works

- **Which plans:** each `plan` block in the answer the contract accepts, the last of each room. One that isn't a plan
  Courtyard can draw is left in the answer, unsaved.
- **One per room:** a room's document is named "<Room> floor plan" and holds only its plan's block, so a redraw
  replaces it, and a plan the same as the one saved saves nothing.
- **Home's plan views:** every document that is one plan and nothing else, newest first, whoever saved it.
- Only planning workspaces keep documents, so a code workspace's plans are drawn, never saved.
