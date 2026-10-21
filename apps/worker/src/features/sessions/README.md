# sessions

Sessions as event logs: runs each turn through a provider and follows it live, from any device.

**Example:** you send "which tyres for winter?". It's written to the session's event log, the turn runs on
Claude, and every page that has the session open gets the answer as it's written.

- **Uses:** `providers/`, `prompts/`, `code/`, `tasks/` (a code session's long commands, #182), `saves/`, `documents/`, `things/`, `projects/`, `attachments/`,
  `suggested-replies/`, `skills/`, `matt-skills/`, `waiting/`, `allow-all/`, `paper/`, `github/`,
  `context-folder/`, `owner-context/`, `workspaces/`; and, handed in by `worker.ts`, `notifications/`
  (`notify`), `next-up/`'s claims (`named`, `claim`, `release`) and `builders/` (#590: told what happens in a
  Lead builder's session as it happens; it starts the builder's one carry-on).
- **Used by:** `worker.ts`, `pull-requests/`, `next-up/`, `lead/`, `changes/`, `fresh-start/`, `matt-skills/`;
  in the web app, [`features/sessions/`](../../../../web/src/features/sessions/README.md).

## API

- `GET /api/providers`: the providers and their models.
- `GET /api/workspaces/:id/sessions`, `POST` the same with a first message: a workspace's sessions, and a new one;
  a first message naming a `project` (#603) starts one that belongs to that project.
- `POST /api/workspaces/:id/seen`: Mark all read (#345).
- `POST /api/workspaces/:id/get-to-know`, `POST /api/owner-context/get-to-know`: Get to know (a session started with
  its house skill).
- `GET`, `PATCH` (rename), `DELETE /api/sessions/:id`; `GET /api/sessions/:id/events?after=N`: the event stream.
- `POST /api/sessions/:id/messages`: the next message, JSON or a multipart form with its files.
- `DELETE /api/sessions/:id/queued/:queued`: remove a queued message.
- `GET /api/sessions/:id/attachments/:attachment`: one attachment.
- `POST /api/sessions/:id/stop`, `…/carry-on`, `…/continue`, `…/seen`.
- `POST /api/sessions/:id/approvals/:approval`: Allow or Deny; `…/allow-all` and `…/allow-all/off`.
- `GET /api/sessions/:id/pull-request` and its `merge`, `close` and `bring-up-to-date`.
- `POST /api/sessions/:id/documents` (Save as document), `…/documents/:save/undo`, `…/things/:save/undo`,
  `…/projects/:save/undo` (#603), `…/saves/:save/undo` and `…/saves/:save/edit`.

## How it works

- **Tools by name.** It answers each call to Courtyard's tools by name: one `callTool` on the provider seam, so a
  new tool needs no adapter change. A new tool is a name in `TurnToolName` (`providers/`), its definition beside its
  replies in `prompts/`, its answer in the turn's `answers` (which the compiler asks for), and a scripted line for
  the fake.
- **Following a turn.** It follows each one live from any position, and handles Stop, Carry on, titles, and Undo and
  Edit of saves.
- **Sent while a turn runs.** A message goes into that answer on a provider that steers (#252, `added.ts`), or is
  queued and sent once the turn ends (#177).
- **Whose turn.** Its list of a workspace's sessions says whose turn it is in each (#179), and puts `waiting/`'s say
  on each one (`waiting`), keeping each session's latest answer in memory (from its event log once recovered, then
  as each is written).
- **Session notes** (#601, ADR 0032; `notes.ts`). Each planning session leaves a note for the next ones in its
  workspace, done · decided · next, kept beside its `session.json` as `note.json`, never in the context folder. It's
  one question to the first errand model with room (`providers/`' `errandModel`), asked by the worker's repeating job
  (`writeQuietNotes`, every five minutes) once the session has been quiet for 30 minutes, or as soon as another
  session starts in its workspace, whichever is first; again once a turn completes after it, from the note so far.
  Only each workspace's latest six sessions are looked at. Every planning turn is given the workspace's latest five
  notes besides its own session's, a new session's first turn once the notes its start asked for are written (at
most 10 seconds, timed by the `wait` the worker is given; past that it answers without them), and
  the `read_session` tool, which opens an earlier session of the same workspace (its owner messages and answers,
  never another workspace's). What a model is told is in docs/ai-conduct.md, Session notes.

### A session's pull request

- **Following it** (#172): it looks at each code session's PR through `code/` and `github/` every 30 seconds (a
  repeating job) and as soon as a turn in one ends, one session at a time, and records each change as a
  `pull-request` event (its number, state, latest commit and checks), which the session page's branch and PR strip
  shows.
- **Checks failing** on a commit not yet asked about start a turn on the model the owner last used, once the session
  is free: its message is the worker's (`checksFailed` on it, worded by `prompts/`), and the failed checks open its
  activity. That turn first checks whether a failing test is its PR's; a flake that isn't is said on the PR and its
  failed jobs re-run once, with no code changed. Checks failing again on the same commit, after they ran again,
  start no second fixing turn: the owner is asked through `notifications/` (#356).
- **A conflict** with its base is brought up to date the same way first (#382): Bring up to date's message,
  `conflicted` on it, once per commit, so one the model can't resolve waits for the owner's Bring up to date.
- **Merged or closed**, anywhere, ends the session: it takes no more messages, and once no turn runs its worktree and
  branch are cleared away.
- Each `pull-request` event carries the PR's size (lines added and removed, files changed, #160), its title (#240),
  and whether it conflicts with its base (#278). A code workspace's list of sessions gives each one's branch and its
  PR as last recorded (kept in memory once read, so the list doesn't read every event log), which the workspace
  page's pull requests list shows (#240).
- **Reviewing it** (#160): `GET /api/sessions/:id/pull-request` answers with the PR's review, asked of GitHub through
  `code/` and `github/` each time: its checks by name, its description as the session wrote it (#240), the files it
  changes with their diffs, and whether it can merge, or why not in the owner's words (checks running or failed, or a
  conflict with its base).
- `pull-request/merge` takes the head commit the browser reviewed and refuses when the PR has moved since ("The pull
  request changed since you looked. Review it again."), or with that reason; else GitHub merges only that commit.
  `pull-request/close` closes it. Either then follows the PR at once, so the session ends as one merged or closed on
  GitHub does.
- `pull-request/bring-up-to-date` (#278) fetches the PR's base through `code/` and sends the session the worker's
  message to merge it in (`bringUpToDateMessage`, worded by `prompts/`), on the model the owner last used there, or
  queues it while a turn runs.

A Lead's builder starts no helpers: its code turns get no `CodeTurn.helper` (#621, ADR 0031). A waiting Update
holds nothing back here: queued messages, fixing turns, task reports and the Lead's merge notes start as usual.
The rest of a turn (saves, approvals, helpers, steering, recovery) is in
[How a turn flows](../../../../../docs/architecture.md#how-a-turn-flows).
