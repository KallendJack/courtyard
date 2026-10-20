# workspace-files

The workspace folder as the edge of what a model may look at (ADRs 0003, 0015).

**Example:** a model in the bike workspace asks to read `../garden/CONTEXT.md`. The real path is outside its
workspace, so the read is refused.

- **Uses:** `lib/files.ts`.
- **Used by:** `providers/` (every provider's reads), `code/`, `skills/`, `prompts/` (wording what they find).

## API

None.

## How it works

- The one check every provider's reads go through, following symlinks to where a path really leads.
- One place outside the folder may be read: the output Claude Code saved for the session's own calls when it was too
  long to hand over (#568). The Claude adapter names that folder by the session's id, so no other session's is in
  reach.
- Courtyard's own file tools, for a provider that has none of its own (Codex, whose shell is off).
