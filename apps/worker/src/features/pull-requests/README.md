# pull-requests

A code workspace's pull requests, whoever opened them (#278).

**Example:** a Claude Code helper opened a PR from your laptop. The workspace's PRs tab lists it beside the sessions'
own, signed "Claude Code", and you can review, merge or close it there.

- **Uses:** `code/`, `github/`, `sessions/`, `waiting/` (what each waits on), `prompts/`, `workspaces/`.
- **Used by:** `quick-questions/` (the review and `carryOver`), `worker.ts`; in the web app,
  `features/pull-requests/`.

## API

- `GET /api/workspaces/:id/pull-requests`: every open one.
- `GET /api/workspaces/:id/pull-requests/:number`, and its `merge`, `close` and `sessions` (Bring up to date, or a
  session on its branch).
- A session's own PR goes through `sessions/`' `/api/sessions/:id/pull-request`.

## How it works

- Lists every open one on its repository through `code/` and `github/`, latest first, each with who it's from: the
  session on its branch (which keeps its link), a Claude Code helper (its description signed "Generated with Claude
  Code"), or its author on GitHub. While GitHub can't be asked, its sessions' open ones as last recorded.
- One no session opened is reviewed, merged and closed by its number; one a session is on goes through that session,
  so it ends as usual.
- Bring up to date, or Fix it in a session (`carryOver`, #327), on it starts a session on its own branch (`code/`'s
  `startOnBranch`, leaving the branch on GitHub, since it isn't a `courtyard/…` one).
- A branch of that name the repository has already (#326) is brought up to its remote and used when it's checked out
  nowhere and has nothing the remote lacks, and the session remembers it didn't make it, so clearing the session
  away leaves it. Otherwise the start is refused, saying which.
- Puts `waiting/`'s say on each open one.
