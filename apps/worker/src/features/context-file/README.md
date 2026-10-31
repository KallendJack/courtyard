# context-file

Reads a context file or the owner context into its sections, and adds, changes or removes one line. Text in, text
out: it never touches the disk.

**Example:** a model saves a fact. This puts it under Facts as a new line; the line labels it added (F1, F2…) are how
a model names a line to change.

- **Uses:** nothing but the contract.
- **Used by:** `saves/`, `owner-context/`, `workspaces/` (each `CONTEXT.md`), `changes/`, `prompts/`,
  `worker.ts`.

## API

None of its own.

## How it works

- Puts line labels on a file for a model: Facts and Ideas, and How to answer me in the owner context.
- A Plans section, from before projects (#603), is kept as written with no labels, so models read it but can't save
  there, and a save recorded in it still undoes.
