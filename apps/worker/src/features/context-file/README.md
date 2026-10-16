# context-file

Reads a context file or the owner context into its sections, and adds, changes or removes one line. Text in, text
out: it never touches the disk.

**Example:** a model saves a fact. This puts it under Facts as a new line; the line labels it added (F1, F2…) are how
a model names a line to change.

- **Uses:** nothing but the contract.
- **Used by:** `saves/`, `owner-context/`, `workspaces/` (each `CONTEXT.md`), `tidy/`, `changes/`, `prompts/`,
  `worker.ts`.

## API

None of its own: `duePlans` is on `GET /api/workspaces/:id` (in `worker.ts`).

## How it works

- Puts line labels on a file for a model.
- Picks out the plans that name a day from today to 7 days on (`plansDue`: `2026-10-18`, `18 Oct` or `Oct 18th`, a
  day without its year being the next to come), which a planning workspace's answer gives as `duePlans` for its
  Home's Next up (#300), today being the worker's clock's.
