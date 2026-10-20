# tasks

A code session's tasks (#182): long commands that outlive the turn that starts them, a dev server or a slow test
run. The worker runs each itself, keeps its output in the session's folder in the data folder (never the event log),
and tells the model when it finishes. The web app's side is [`tasks/`](../../../../web/src/features/tasks/README.md).

**Example:** Claude runs `pnpm dev` in the background and ends its turn. The server keeps running, its row sits above
the Reply box with its last line, and if it crashes, a turn starts telling Claude so, with its last lines of output.

- **Uses:** `lib/files.ts` (reading the end of its output), the contract.
- **Used by:** `sessions/`, which decides each task's command as it decides any (`CodeTurn.task`), records its start
  and end, and tells the model; `providers/` (Claude's background flag, the fake's `start task:`); `preview/`, through
  `sessions/`, which reads the start of a running task's output for where it serves (#183) and starts Start preview's.

## API

- `GET /api/sessions/:id/tasks`: those still running, each with the last line it printed.
- `GET /api/sessions/:id/tasks/:task/output`: its output's end (at most 200,000 characters), and whether there's more.
- `POST /api/sessions/:id/tasks/:task/stop`: the owner's Stop, which tells nobody.

## How it works

- **A keeper per task** (`keeper.ts`), a small Node process the worker starts, runs the command through the shell
  with its output going straight to `tasks/<task>.log` in the session's folder. It ends the command's whole process
  tree when told "stop", or when the worker goes (its input closes), so no task outlives the worker.
- **At most three** run in a session at once (`TASKS_AT_ONCE`); a fourth isn't started.
- **Its environment** is a code session's command's. A heavy check run as a task has taken its place in the builds
  queue first (#589, `code/builds.ts`), kept until it ends, so it has the builds lock's "held" mark; anything else
  hasn't, so a heavy check it runs takes its own place.
- **A Lead's builder** runs only dev servers and previews as tasks: its checks run in its turn (#589).
- **How it ended** is passed (exit code 0), failed (its exit code), or stopped: by the owner, as its session ended
  (its pull request merged or closed, deleted, a fresh start), or by a restart, which the next worker records.
