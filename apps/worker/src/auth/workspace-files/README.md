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
- Courtyard's own file tools, for a provider that has none of its own (Codex, whose shell is off).
