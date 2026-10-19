# status-line

The status line under a workspace's name (#256): a tiny checklist, ✓ just done · ● now · ○ next, a few words each.

**Example:** Mountain biking reads "✓ Shock pump · ● Lights · ○ Shoes". You tell a session the lights came; as its turn
ends, a short question to Claude's errand model (Sonnet at Low) moves the line along to "✓ Lights · ● Shoes". Or you
tap Lights and Done, and it moves along at once, with no model.

- **Uses:** `workspaces/` (the workspace and its context file), `prompts/` (what the model is told), `providers/` (each
  provider's `errand` model), `sessions/` and `next-up/` (a code workspace's line), `lib/files.ts`.
- **Used by:** `worker.ts`, `sessions/` (`StatusLineHooks`: a planning session's turn ended); in the web app,
  `features/status-line/`.

## API

- `GET /api/workspaces/:id/status-line`: `StatusLine`, its three places, each an item or `null`, and whether the owner
  can change it.
- `POST /api/workspaces/:id/status-line`: `StatusLineChange`, Done (now or next), Edit or Remove: the line as it is
  then. 404 for Done or Remove on an empty place; 409 on a code workspace.

## How it works

- **A planning workspace's line** is Courtyard's own state, kept in the data folder (`status-line/<workspace>.json`),
  not a change to the context folder.
- **Moved along** (docs/ai-conduct.md, The status line) when one of its sessions' turns completes with nothing more
  queued: one one-off question to the first errand model with room, given the context file, the line and the session's
  last three exchanges. An item whose words it keeps stays as it was, the owner's edit and all; a new one is the
  session's (`from`). Written only if the line is still as it was read, so the owner's change made meanwhile wins. One
  at a time per workspace; turns ending meanwhile are taken next, from the latest.
- **Done** moves the line along with no model: now becomes just done and next becomes now; next done becomes just
  done. **Edit** marks the item the owner's own words (`edited`) until a session moves it on.
- **A code workspace's line** is built when asked, from its data with no model: ✓ the last pull request merged from
  one of its sessions, ● its first running build (not the Lead), ○ the first ready issue in Next up, each title in
  product words (no "Build #12: ", no "(#12)"). Nothing on it is the owner's to change.
- The journey book (#452) is to share the end-of-session question, so a day's journey line and ✓ never disagree.
