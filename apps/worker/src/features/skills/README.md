# skills

A workspace's skills (ADR 0016), worked out in one place, the more specific winning by name.

**Example:** your bike workspace has its own `packing` skill and the top level has one too. The workspace's wins, and
every turn lists it.

- **Uses:** `matt-skills/`, `workspace-files/` (confining reads to a skill's folder).
- **Used by:** `sessions/`, `prompts/` (the skills list), `worker.ts`.

## API

- `GET /api/workspaces/:id/skills` (in `worker.ts`).

## How it works

- In order: the workspace's own `.agents/skills` in the context folder, a code workspace's repo's, the context
  folder's top-level one, in a code workspace Matt Pocock's from `matt-skills/` (ADR 0024, each marked for the picker
  or not), then the house skills for its kind of workspace from `packages/skills`.
- Keeps each skill's source, skips a broken one with why, and keeps one with scripts out of a planning workspace.
- Answers the use skill tool: a skill's `SKILL.md`, or one of its files, confined to its folder.
