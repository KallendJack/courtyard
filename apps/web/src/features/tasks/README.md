# tasks

A code session's tasks (#182), as the session page shows them. The worker's side is
[`tasks/`](../../../../worker/src/features/tasks/README.md).

**Example:** the model starts `pnpm dev` as a task. A row above the Reply box shows it with how long it's run and its
last line; a tap opens its full output, live, with Stop. When it ends, a line in the conversation where it ended says
so ("`pnpm test` · 2:14 · finished · passed"), and opens its output.

- **Uses:** `components/` (the task line in `chat/task-line.tsx`, the sheet, kept answers).
- **Used by:** `routes/` (the session page's footer) and `features/sessions/` (each ended task's line in a turn).

## Screens

- **The rows above the Reply box** (`task-lines.tsx`, `RunningTaskRows`): one per running task, from the session's
  events, each one's last line asked of the worker the shared way.
- **A task's line in the conversation** (`task-lines.tsx`, `TaskEndedLine`), where it ended.
- **Its output** (`task-output.tsx`), loaded when one first opens: live while it runs, with Stop.
- `api.ts` holds the calls: running tasks, a task's output, Stop.
