# planning-home

A planning workspace's page under its name (#300; Paper, "Tablet · Planning workspace Home" and its Sessions, Things
and Docs tabs).

**Example:** the Bike workspace opens on Home: Next up says "Pick up: Winter tyres", then What Courtyard knows, then
the message box.

- **Uses:** `features/sessions/`, `features/things/`, `features/documents/`, `components/layout/home-block.tsx`,
  `components/workspace/`. The worker's side is `GET /api/workspaces/:id` and its `duePlans`
  ([`context-file/`](../../../../worker/src/features/context-file/README.md)).
- **Used by:** a workspace's page (`routes/_app/workspaces.$workspaceId.index.tsx`), loaded only for a planning one.

## Screens

- **Tabs:** Home · Sessions · Things · Docs, each but Home shown once it has something, with its count, by the
  address's hash (`#sessions`, `#things`, `#docs`; a document or Thing deleted from its page comes back to its tab,
  with Undo).
- **Home:** Next up (`next-up.tsx`: the session to pick up again, one the worker says waits on the owner, else the
  last used in the past week, then the worker's `duePlans`; hidden with neither), then the one row for What
  Courtyard knows (`knows.tsx`, `#knows`: the facts, plans and ideas, each line with Fix, which shows then starts a
  session on it, each plan with Grill this plan; Get to know while there are no lines; what else models read, Recent
  changes, Tidy, and the skills), then the message box pinned at the foot.
- An empty workspace shows only its name, one line and the box.

## How it works

- A stylesheet of its own (`planning-home.css`, holding the tabs' and Home's blocks' classes too), like `code-home/`.
- Drawn blocks (#257, #152, #294) and the page choices that pin and hide them come with their own issues.
