# providers

The provider seam: Claude, Codex and the fakes look the same to the rest of the worker.

**Example:** a session's turn runs on Codex today and Claude tomorrow. `sessions/` calls the same `turn` either way;
only the adapter knows how its provider is signed in or billed (ADR 0003).

- **Uses:** `prompts/`, `code/` (`CodeTurn`), `workspace-files/`, `sources/`.
- **Used by:** `sessions/`, `limits/` (wraps each one), `tidy/`, `quick-questions/`, `lead/`, `attachments/`,
  `paper/`, `sign-ins/`, `worker.ts`.

## API

None of its own: its models show on `sessions/`' `GET /api/providers`.

## How it works

- `index.ts` says what every provider does: its status, its models, one turn, one-off questions, a sign-in when it
  has one.
- Behind it are three adapters: `claude.ts`, `codex.ts` and `fake.ts`. How each passes on what Courtyard's models
  read is in [The AI setup](../../../../docs/architecture.md#the-ai-setup).
- **Coding** (#248, ADR 0029): Claude codes with Claude Code's own tools behind its hook; Codex, its shell off, with
  Courtyard's coding tools (the framing's `codeTools`), each asked of `CodeTurn` before the adapter does it in the
  worktree. Either way the worker decides every edit and command in one place.
- **Status** (#282): Claude and Codex keep theirs with `createStatusKeeper`: a good answer for a minute, one saying
  they can't be used for a few seconds, the last good one through a check that gets no answer in time, and a
  finished turn counts as a good check.
