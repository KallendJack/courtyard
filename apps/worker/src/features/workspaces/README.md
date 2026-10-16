# workspaces

The list of workspaces: reads, creates, renames and archives workspace folders, and keeps each one's icon and order.

**Example:** you add a workspace called "Bike". It gets a folder with a starter `CONTEXT.md`, the bike icon its name
suggests, and a place at the end of the planning group.

- **Uses:** `context-file/` (to read each `CONTEXT.md`).
- **Used by:** almost every feature, to find a workspace and read its config; `worker.ts` serves its routes.

## API

All in `worker.ts`:

- `GET`, `POST /api/workspaces`: the list, and a new workspace (with a `repo`, a code one, placed by `repos/`).
- `PUT /api/workspaces/order`: Arrange workspaces (`arrangeWorkspaces`, #321).
- `GET`, `PATCH /api/workspaces/:id`, `POST /api/workspaces/:id/archive`.

## How it works

- **Icons** (#210): the one the owner picked, or else the one its name suggests (`icons.ts`: a word match, `code` for
  a code workspace, else `book`), kept in its config when it's added.
- **A code workspace** has no context file (ADR 0026): its name, its one line (`description`) and its connections
  are in its `workspace.json`, and one kept from before is read only for its title and intro line until the config
  has them.
- **A new planning workspace's** starter context file has no intro line unless the owner gave one, and the hint
  older starters wrote there is read as none and left out of what models read (`withoutStarterHint`, #300).
- **Paper:** it keeps the Paper file connected from the page in the config's `connections` (`connectPaper`, #308).
- **Order** (#321): planning ones first, then code ones, each group in the owner's order: one list of ids in
  `workspace-order.json` at the context folder's top, kept by `arrangeWorkspaces`, which refuses an order that mixes
  the groups. A workspace the order doesn't name goes at the end of its group, by name.
- It reads a code workspace's allowlist changes (`allowlist: { add, remove }`) and Paper settings for `code/` and
  `paper/`, and writes `{ mode: "code", repoPath }` for a new code workspace.
