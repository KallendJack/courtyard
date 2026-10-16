# connections

A code workspace's connections (#308): GitHub and its Paper file.

**Example:** the connections line says "GitHub · Paper: not connected". You tap it, pick a Paper file, and every turn
from then on is told it can draw there.

- **Uses:** `code/`, `github/`, `paper/` (listing and making files), `context-folder/`, `workspaces/`.
- **Used by:** `sessions/` (each turn is told them, `of`), `matt-setup/`, `repos/`, `worker.ts`; in the web app,
  `features/code-home/` (`connections.tsx`).

## API

- `GET /api/workspaces/:id/connections`, `GET …/connections/paper/files`, `POST …/connections/paper`.

## How it works

- GitHub: its repository on GitHub and whether Courtyard is signed in.
- Its Paper file, as its page's connections line and Connections sheet show it and as each of its turns is told it.
- Lists the owner's Paper files and connects one, or makes one named after the workspace, as one change through
  `context-folder/`.
- Paper's command is the workspace's own, else the `COURTYARD_PAPER_COMMAND` setting, else the one another code
  workspace names.
