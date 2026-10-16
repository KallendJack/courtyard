# owner-context

Reads `OWNER.md`, the owner context every workspace gets, and starts a new one (ADR 0010).

**Example:** you say "keep answers short" in any workspace. The save lands in `OWNER.md`, so every workspace's models
read it from then on.

- **Uses:** `context-file/`, `workspaces/`.
- **Used by:** `context-folder/`, `saves/`, `sessions/`, `worker.ts`.

## API

- `GET`, `POST /api/owner-context` (in `worker.ts`): Settings' owner context panel.
