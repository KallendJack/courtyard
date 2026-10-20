# waiting

What waits on the owner (#334; AGENTS.md), decided here once for every screen and device, and gathered from every
workspace into one list (#492).

**Example:** a session's answer arrives while you're away. Its row says "new reply" on every device until a session
page has shown it to you, and Home's Needs you lists it, "Reply · Winter tyres · Bike", with the Courtyard mark's
gold count.

- **Uses:** the contract, `sessions/` (each workspace's listed sessions) and `workspaces/` (the list), for its route.
- **Used by:** `sessions/` (on each listed session), `pull-requests/` (on each open one) and `limits/` (the warnings
  before a limit). The web app reads those: a Home tile names the newest session waiting, and every session list
  marks those waiting and puts them first (#345). It reads `GET /api/needs-you` for Home's Needs you, the mark's
  count and a session's Next pill (#492).

## API

- `GET /api/needs-you`: everything waiting on the owner in every workspace, in Needs you's order, and `busy` while a
  turn runs anywhere (`NeedsYou`).

Seen is `sessions/`' `POST /api/sessions/:id/seen` and `POST /api/workspaces/:id/seen`.

## How it works

- **A session** waits for its approval while one is asked for.
- Else, a Lead's builder that's **stuck** (#590, its status from `builders/`), saying why, until it carries on.
- Else as a **new reply** while its latest answer (the last turn that completed or failed) is under a day old, no
  turn runs or waits for a slot, it has no pull request, and the owner hasn't **seen** it.
- **Seen:** the session page tells the worker the last event it showed once no turn runs and it's in view, kept as
  `seen.json` in the session's folder, never going back. Mark all read sees every session in a workspace up to its
  latest answer (#345).
- **An open pull request** waits for its conflict, its failing checks (unless its session is working on them, #172),
  or a merge once its checks pass. A Dependabot bump's failing checks wait on no one while the worker re-runs them or
  the Lead fixes them, only once it's still failing after that fix (#496).
- **A plan near its limit** (#66): a provider's fullest window from 80% warns, fullest first and at most two, unless
  Not now put it off until it resets (it comes back once past 95%). It offers Switch to the first other provider
  connected with room, saying that one's own window when it's past 80% too; at 100% with nowhere to switch, there's
  no warning, as the limit card after the turn says it.
- **Needs you, everywhere** (#492): each workspace's sessions, and the pull request each one opened as the worker
  last followed it, so it never asks GitHub. A pull request no session opened shows on its code workspace's own
  Needs you. In order: stuck builders, approvals, turns cut off, failing checks, new replies, merges, conflicts, the newest first in
  each.
