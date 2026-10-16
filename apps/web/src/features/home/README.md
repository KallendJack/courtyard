# home

What the home page loads after it shows (#102; Paper, "Home"): each tile's line and the foot rows.

**Example:** the Bike tile says "New reply · Winter tyres", and the foot says the backup is behind, with Fix it.

- **Uses:** `features/code-home/` (`needs.ts`), `features/pull-requests/` (`open-pull-requests.ts`),
  `features/live/`, `features/sessions/`, `features/settings/`.
- **Used by:** the home page (`routes/_app/index.tsx`).

## Screens

The home page: its title pinned at the top, the foot rows at the foot, and only the tiles scrolling between them
(#339).

## How it works

- A stylesheet of its own (`home.css`), like `code-home/`.
- **Each tile's line** (`tile-line.tsx`): what waits on the owner, as the worker says and Needs you reads it
  (`code-home/needs.ts`), from the workspace's sessions and, on a code workspace, its open pull requests (the store
  its Home and PRs list share), else when it was last used. Kept for the tab's lifetime, a faint line in its place
  until then, so nothing jumps.
- **The foot rows** (`foot.tsx`), shown only when needed: main's build with Update (`live/`), and one gold problem
  line, the worst of what's wrong (context changes not kept, the backup behind, a workspace's config ignored, no
  backup set up), with Fix it to where it's fixed.
