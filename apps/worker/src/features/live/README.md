# live

For the live copy only: whether `main` has moved on, updating, and how the last update went
([ADR 0011](../../../../../docs/adr/0011-the-live-worker-is-its-own-copy-of-main-started-at-log-on.md)).

**Example:** a PR merges while a session is mid-turn. You tap Update; it waits for the turn and main's build, then
updates and restarts, and the cut-off turns carry on.

- **Uses:** the update command, passed in; `github/` and `code/` for main's build, through `worker.ts`.
- **Used by:** `worker.ts`; `sessions/` and `lead/` read its `holding()`; in the web app, `features/live/`.

## API

All in `worker.ts`:

- `GET /api/live`: where the live copy stands, with main's build.
- `POST /api/live/update` (Update when ready, or Update now) and `DELETE` the same (Cancel).

## How it works

- **Update when ready** (#186): tapped while main's build runs or a session is mid-turn (`sessions/`' `midTurn`, an
  approval waiting counted), it waits, kept in the data folder (`live-update-waiting.json`) so a crash keeps it.
  A repeating job runs it once both are clear, or drops it when main's build fails meanwhile. Update now runs it at
  once; Cancel drops it, even while the job is reading main's build (that look then does nothing, #586).
- **Holding:** while one waits, `holding()` tells `sessions/` and `lead/` that nothing new starts on its own (queued
  messages hold, no fixing turn, no new builder); the owner's own messages still start.
- **After a restart:** an update the worker starts itself leaves a note (`live-update-restart.json`), so the next
  worker continues the turns it cut off.
- **Main's build** (#249), while main has moved on: CI on main's newest commit, asked of GitHub through `github/` (on
  the repository the live copy's remote names, read through `code/`) only when a page asks for the live status, at
  most every 8 seconds while it runs and once a minute otherwise; none when no one is signed in to GitHub.
