# designs

A code workspace's Designs tab (#522): its Paper file's boards on Live, Agreed and Drafts, row by row, as pictures.

**Example:** you open Designs on a code workspace. Live shows "Style guide & brand", then "Home" with its Desktop,
Tablet and Cover boards, "From Paper · 2 min ago"; with Paper closed, the same pictures say how old they are.

- **Uses:** `integrations/paper/` (`boards`, through Paper's own MCP server), `workspaces/` (the workspace's Paper
  file), `sessions/` (`Background`).
- **Used by:** `worker.ts`; in the web app, `features/designs/`.

## API

- `GET /api/workspaces/:id/designs`: the three pages, each with its count and rows, when they were exported, whether
  an export is running, and whether Paper was reached last time.
- `GET /api/workspaces/:id/designs/pictures/:name`: one board's picture, kept for good (its name is its bytes' hash).

## How it works

- A visit asks Paper again in the background once the last try is five minutes old; the tab keeps asking, faster while
  it runs. One export per workspace at a time.
- Pages are found by name (`1 · Live`, `2 · Agreed`, `3 · Drafts`). `rows.ts` lays out each page once: a
  `Section · <area>` board starts a row and the boards from its top down to the next section's join it, Desktop,
  Tablet and Cover left to right; boards with no section (Drafts' grid by topic) make a row for each line of the
  grid, named by the first part of their names when they share it.
- Kept in the worker's data, `designs/<workspace>/`: `designs.json` and the pictures, a picture no board shows any
  more removed after each export.
