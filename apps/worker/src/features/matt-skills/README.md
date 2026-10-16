# matt-skills

Matt Pocock's skills for code workspaces, from a pinned copy
([ADR 0024](../../../../../docs/adr/0024-code-workspaces-load-matt-pococks-skills-as-a-plugin-from-a-pinned-copy.md)).

**Example:** a code session's Skill picker lists `tdd` and `grilling`. They come from the release `matt.json` pins,
checked against its checksum.

- **Uses:** `sessions/` (types); fetching is a dependency passed in (`fetchFromGitHub`).
- **Used by:** `sessions/` (each code turn's `CodePlugin`), `skills/`, `matt-setup/`, `worker.ts`.

## API

None.

## How it works

- Fetches the release `packages/skills/matt.json` names from his plugin list into the data folder, keeping only his
  `plugin.json`, licence and the skills it lists.
- Gives the copy (`copy()`) only when it matches the pin's checksum (`mattChecksum`), or why not; a failure is tried
  again after five minutes.
- Fetching is a dependency passed in (`fetchFromGitHub`, git at his release's tag, the one real one).
- `sessions/` hands a code turn the copy as its `CodePlugin`, with the skills of it the workspace can use, and leaves
  them out of Courtyard's own skills list.
