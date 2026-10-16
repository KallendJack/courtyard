# waiting

What waits on the owner (#334; AGENTS.md), decided here once for every screen and device, with no I/O of its own.

**Example:** a session's answer arrives while you're away. Its row says "new reply" on every device until a session
page has shown it to you.

- **Uses:** nothing but the contract.
- **Used by:** `sessions/` (on each listed session) and `pull-requests/` (on each open one). The web app reads only
  those: a Home tile names the newest session waiting, and every session list marks those waiting and puts them
  first (#345).

## API

None of its own: `waiting` is on `sessions/`' list and `pull-requests/`' list. Seen is `sessions/`'
`POST /api/sessions/:id/seen` and `POST /api/workspaces/:id/seen`.

## How it works

- **A session** waits for its approval while one is asked for.
- Else as a **new reply** while its latest answer (the last turn that completed or failed) is under a day old, no
  turn runs or waits for a slot, it has no pull request, and the owner hasn't **seen** it.
- **Seen:** the session page tells the worker the last event it showed once no turn runs and it's in view, kept as
  `seen.json` in the session's folder, never going back. Mark all read sees every session in a workspace up to its
  latest answer (#345).
- **An open pull request** waits for its conflict, its failing checks (unless its session is working on them, #172),
  or a merge once its checks pass.
