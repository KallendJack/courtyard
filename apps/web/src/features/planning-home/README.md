# planning-home

A planning workspace's page under its name (#300, #565; Paper, "Tablet · Planning Home: the bike, part by part (#565)"
and its Desktop and Cover boards).

**Example:** the Bike workspace opens on Home: the bike's photo, its chain, rear tyre, fork and saddle labelled beside
it, each with a line to its pin, the chain and the rear tyre with a gold dot. Tap Fork and its card opens under the
photo: "RockShox · 120 mm", with Open and Ask about it.

- **Uses:** `features/sessions/` (the message box, Start, and History's list), `features/things/`,
  `features/documents/`, `components/photo/` (the photo with its pins and labels, the header's ring),
  `components/workspace/` (its pills), `components/forms/segmented-choice.tsx` (the view chips). The worker's side is
  `GET /api/workspaces/:id/home`, `PUT …/home/showing`, and a Thing's `PUT …/pin` and `PUT …/mark`
  ([`planning-home/`](../../../../worker/src/features/planning-home/README.md),
  [`things/`](../../../../worker/src/features/things/README.md)).
- **Used by:** a workspace's page (`routes/_app/workspaces.$workspaceId.index.tsx`), loaded only for a planning one.

## Screens

- **Its header:** the name with its ⋯ (Rename, Change icon, What Courtyard knows, Allowed commands, Notify me, Blocked shops, Archive), the
  workspace's photo top right (`header-photo.tsx`: its main Thing's, opening its card; with none, the workspace's icon
  in the same ring, offering to take or pick one), and the pills: + New · History · Things · Docs, each tab once it has
  something, with its count, by the address's hash. The chosen pill leads back to Home.
- **Home** (`home-now.tsx`): the view showing in one panel, a chip for each when there are several, the pick kept by
  the worker; and nothing else, no chat. With nothing to show, the panel keeps its size with one quiet line.
- **The Breakdown view** (`breakdown-view.tsx`): a Thing's photo with every part pinned, a gold dot for one that needs
  something; from a tablet up each part's label beside the photo with a line to its pin (labels with no pin yet at the
  foot of the shorter side), on the cover screen every part in a list under it. A tap on a label, a pin or a row opens
  the part's card (`part-card.tsx`) in a place kept for it under the photo: what's fitted (brand and size), its other
  details, what it needs, Done it, Open and Ask about it. Chosen with no pin, a tap on the photo places it. A mouse
  drags a pin; a finger holds it first.
- **The box:** it starts a new session. While Home shows a view it's out of sight until Talk, + New (`#new`) or Ask
  about it opens it (`tucked`, `components/frame/handheld.ts`); with no view it stays under the quiet line. A photo or
  doc from Add goes in it.
- **History:** the latest session's row has the next steps its last answer suggested, each replying in that session.
- **The plan view** (#257; Paper, "Tablet · Floor plan in an answer (#257)"): a room's floor plan, drawn by the same
  rich block as in an answer (`components/rich-blocks/floor-plan.tsx`, told it's `OnHome`), its list of things
  scrolling inside the block, which keeps its size.
- **Add** on the frame's rail: a Thing, a photo or a doc.
- An empty workspace shows only its name, one line and the box.

## How it works

- A stylesheet of its own (`planning-home.css`, holding the pills' and Home's classes too), like `code-home/`.
- Home comes with the page (`api/workspace-page.ts`), kept for the next visit, and stays fresh the shared way, faster
  while its latest session is being answered.
