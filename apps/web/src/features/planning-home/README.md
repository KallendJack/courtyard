# planning-home

A planning workspace's page under its name (#300, #481; Paper, "Tablet · Home: the bike, parts pinned (#481)" and its
Desktop and Cover boards).

**Example:** the Bike workspace opens on Home: "Is the bike ready for Saturday?" above the bike's photo, the chain and
rear tyre pinned in gold beside what each needs, "Find a chain under £30" and "Which lights?" under it, and Reply at the
foot.

- **Uses:** `features/sessions/` (the message box, Reply and Start), `features/things/`, `features/documents/`,
  `components/photo/` (the photo with its pins, the header's ring), `components/workspace/` (its pills),
  `components/forms/segmented-choice.tsx` (the view chips), `components/chat/suggested-replies.tsx` (the next steps).
  The worker's side is `GET /api/workspaces/:id/home`, `PUT …/home/showing`, and a Thing's `PUT …/pin` and
  `PUT …/mark` ([`planning-home/`](../../../../worker/src/features/planning-home/README.md),
  [`things/`](../../../../worker/src/features/things/README.md)).
- **Used by:** a workspace's page (`routes/_app/workspaces.$workspaceId.index.tsx`), loaded only for a planning one.

## Screens

- **Its header:** the name with its ⋯ (Rename, Change icon, What Courtyard knows, Allowed commands, Archive), the
  workspace's photo top right (`header-photo.tsx`: its main Thing's, opening its card; with none, the workspace's icon
  in the same ring, offering to take or pick one), and the pills: + New · History · Things · Docs, each tab once it has
  something, with its count, by the address's hash. The chosen pill leads back to Home.
- **Home** (`home-now.tsx`): the owner's last question, opening its session; the view showing, with a chip for each
  when there are several, the pick kept by the worker; the next steps its answer suggested, once it's finished, each
  replying in that session; and the Reply box at the foot carrying it on. + New (`#new`), or a photo or doc from Add,
  starts a new session instead.
- **The picture view** (`picture-view.tsx`): a Thing's photo with its parts pinned, numbered gold where they need
  something, faint dots otherwise; beside it on a tablet, under it on the cover screen, only what needs doing, never
  brands or sizes (#220). A tap on a pin or a row opens the part's card (`part-card.tsx`: Done it, Add to wanted, its
  Thing's card): beside them on a wide screen, over the page otherwise. A mouse drags a pin; a finger holds it first.
- **The plan view** (#257; Paper, "Tablet · Floor plan in an answer (#257)"): a room's floor plan, drawn by the same
  rich block as in an answer (`components/rich-blocks/floor-plan.tsx`, told it's `OnHome`), its list of things
  scrolling inside the block, which keeps its size.
- **Add** on the frame's rail: a Thing, a photo or a doc.
- An empty workspace shows only its name, one line and the box. The wanted list view comes whole with #245.

## How it works

- A stylesheet of its own (`planning-home.css`, holding the pills' and Home's classes too), like `code-home/`.
- Home comes with the page (`api/workspace-page.ts`), kept for the next visit, and stays fresh the shared way, faster
  while its last question is being answered.
