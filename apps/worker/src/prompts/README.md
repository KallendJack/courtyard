# prompts

Everything a model reads, built from [`ai-conduct.md`](../../../../docs/ai-conduct.md). Read that before changing
any of it.

**Example:** each turn in a planning workspace starts with the owner context, the workspace's context file with line
labels, its documents and Things, the skills list and the conversation so far, and offers Courtyard's tools.

- **Uses:** `context-file/`, `saves/`, `documents/`, `things/`, `skills/`, `sources/`, `suggested-replies/`,
  `attachments/`, `code/`, `workspace-files/`, `providers/` (types).
- **Used by:** `sessions/`, `providers/`, `tidy/`, `quick-questions/`, `pull-requests/`, `next-up/`, `lead/`,
  `paper/`, `worker.ts`.

## API

None.

## How it works

- **Each turn's framing:** instructions with the documents and Things lists, the skills list and the skills in use,
  the conversation so far, and Courtyard's tools (the save tool, the document tool, the Things tool, use skill and
  suggest replies).
- **The replies** to Courtyard's tools.
- **The text for** Tidy, titling a session, a pull request's quick questions, and the worker's own messages (Build's
  and Grill's first message, checks failing, Bring up to date).
