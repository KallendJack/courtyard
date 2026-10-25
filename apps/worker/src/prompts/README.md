# prompts

Everything a model reads, built from [`ai-conduct.md`](../../../../docs/ai-conduct.md). Read that before changing
any of it.

**Example:** each turn in a planning workspace starts with the owner context, the workspace's context file with line
labels, its documents and Things, the skills list and the conversation so far, and offers Courtyard's tools.

- **Uses:** `context-file/`, `saves/`, `documents/`, `things/`, `projects/`, `fabrication/`, `skills/`, `sources/`,
  `suggested-replies/`, `attachments/`, `code/`, `workspace-files/`, `providers/` (types), and `@courtyard/fabrication`
  (a Build's parameters as JSON Schema, and the numbers it works out).
- **Used by:** `sessions/`, `providers/`, `quick-questions/`, `pull-requests/`, `next-up/`, `lead/`,
  `paper/`, `worker.ts`.

## API

None.

## How it works

- **Each turn's framing:** instructions with the documents, Things and projects lists (and the project the session
  belongs to, whole; #603), its Builds (#697), the notes the workspace's latest sessions left (#601), the skills list and the skills in
  use, the conversation so far, and Courtyard's tools (the save tool, the document tool, the Things tool, the project
  tool, read session, use skill and suggest replies). The two kinds of workspace differ on purpose (ADR 0032): a planning turn gets floor plans and how
  to help there (brief, one step at a time, asking, real products, what's saved, a pro, diagrams only when asked,
  going ahead when asked, a caveat once, another AI's plan as ideas; #700); a
  code turn gets diagrams and the house process.
- **Builds** (`builds.ts`, #697): the Builds list, the rule for the Build tool, the tool, and its reply, every
  number the engine worked out for the model to report.
- **Sizes** (`sizes.ts`, #708): the recorded sizes list, the rule for the size tool, the tool, its reply and its
  refusals, such as measured for a value the owner never gave.
- **Your tools** (`tools.ts`, #707): the owner's tools in every planning turn, and the one question that ticks the
  tools the owner said under "Or just say it".
- **The replies** to Courtyard's tools, and the pieces they share (`text.ts`: the markers' guard, a quoted name, a
  reply in words).
- **The text for** titling a session, writing a session's note, a pull request's quick questions, and the worker's own messages (Build's
  and Grill's first message, checks failing, Bring up to date).
