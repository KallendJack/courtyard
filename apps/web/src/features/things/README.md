# things

A workspace's Things: the section, each Thing's card, and Add Thing. The worker's side is
[`things/`](../../../../worker/src/features/things/README.md).

**Example:** the Things tab lists "Chain · Part of: Bike · Worn". You open its card, see its history, and edit it
with a new photo.

- **Uses:** `features/changes/` (Undo after a delete), `features/sessions/` (the answer renderer for its history).
- **Used by:** `features/planning-home/`, `features/sessions/` (a Thing save's note), a Thing's page
  (`routes/_app/workspaces.$workspaceId.things.$slug.tsx`).

## Screens

- The Things section (`things-section.tsx`, filtered by status) and the rows both list them in, parts under their
  Thing (`thing-rows.tsx`).
- A Thing's card (`thing-card.tsx`, its route in `routes/`, its history drawn with the answer renderer).
- Add Thing's and Edit's form (`thing-form.tsx`).

## How it works

- Its calls (`api.ts`), and how their fields read (`words.ts`).
- Like `components/rich-blocks/`, its classes are in a stylesheet of its own (`things.css`, which `styles.css` leaves
  the folder out of), added by `stylesheet.ts` when one of its pages first loads, and applying only inside a
  `ThingsScope` (`scope.tsx`), for the same reason.
