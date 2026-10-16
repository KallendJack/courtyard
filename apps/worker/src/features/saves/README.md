# saves

Checks a model's save to context and writes it as a change; the owner's Undo and Edit from a save's note.

**Example:** a model saves "Rides a 2019 Trek Domane" to the bike workspace's facts. It's checked, written as one
commit, and the chat shows a note with Undo and Edit.

- **Uses:** `context-file/` (to add, change or remove the line), `context-folder/` (to commit it), `owner-context/`,
  `workspaces/`.
- **Used by:** `sessions/` (each save tool call, and Undo and Edit), `changes/`, `prompts/` (the save tool's replies).

## API

None of its own: Undo and Edit go through `sessions/`'s `…/saves/:save/undo` and `…/saves/:save/edit`.

## How it works

- A refused save is explained to the model, which may put it right once
  ([ADR 0013](../../../../../docs/adr/0013-models-save-context-as-they-chat-and-the-owner-undoes.md)).
