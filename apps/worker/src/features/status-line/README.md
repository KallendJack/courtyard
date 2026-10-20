# status-line

The status line under a code workspace's name (#256): a tiny checklist, ✓ just done · ● now · ○ next, a few words
each, built from its data with no model. A planning workspace has none (#600).

**Example:** Courtyard's code workspace reads "✓ PR review screen · ● Steer while it answers · ○ Session slots": its
last merged pull request, the build running now, and the first ready issue in Next up.

- **Uses:** `workspaces/` (the workspace's kind), `sessions/` and `next-up/` (what the line is built from).
- **Used by:** `worker.ts`; in the web app, `features/status-line/`.

## API

- `GET /api/workspaces/:id/status-line`: `StatusLine`, its three places, each an item or `null`. 404 for a planning
  workspace.

## How it works

- **Built when asked,** from the workspace's data with no model: ✓ the last pull request merged from one of its
  sessions, ● its first running build (not the Lead), ○ the first ready issue in Next up, each title in product words
  (no "Build #12: ", no "(#12)"). Nothing on it is the owner's to change.
