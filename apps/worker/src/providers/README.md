# providers

The provider seam: Claude, Codex and the fakes look the same to the rest of the worker.

**Example:** a session's turn runs on Codex today and Claude tomorrow. `sessions/` calls the same `turn` either way;
only the adapter knows how its provider is signed in or billed (ADR 0003).

- **Uses:** `prompts/`, `code/` (`CodeTurn`), `workspace-files/`, `sources/`.
- **Used by:** `sessions/`, `limits/` (wraps each one), `quick-questions/`, `lead/`, `attachments/`,
  `paper/`, `sign-ins/`, `worker.ts`.

## API

None of its own: its models show on `sessions/`' `GET /api/providers`.

## How it works

- `index.ts` says what every provider does: its status, its models, one turn, one-off questions, a sign-in when it
  has one, and its plan usage when it has plan limits (`readUsage`, and `TurnInput.heardUsage` as a turn runs, #66).
- Behind it are three adapters: `claude.ts`, `codex.ts` and `fake.ts`. How each passes on what Courtyard's models
  read is in [The AI setup](../../../../docs/architecture.md#the-ai-setup).
- **Coding** (#248, ADR 0029): Claude codes with Claude Code's own tools behind its hook; Codex, its shell off, with
  Courtyard's coding tools (the framing's `codeTools`), each asked of `CodeTurn` before the adapter does it in the
  worktree. Either way the worker decides every edit and command in one place.
- **Helpers** (#117, #470, ADR 0027): Claude starts Claude Code's own sub-agents, each tool call told apart by its
  hook; Codex's own get none of Courtyard's tools, so Codex starts helpers with Courtyard's `start_helper`, each a
  fresh thread the adapter runs with the coding tools. Either way each one works through the `HelperTurn` the worker
  gives it with `CodeTurn.helper`. When that's `null` (a Lead's builder, #621, ADR 0031), neither offers the model
  a way to start one: Claude gets no `Agent` tool, Codex no `start_helper`.
- **Status** (#282): Claude and Codex keep theirs with `createStatusKeeper`: a good answer for a minute, one saying
  they can't be used for a few seconds, the last good one through a check that gets no answer in time, and a
  finished turn counts as a good check.
- **Errands** (#245): a provider names its cheap model and effort for a short background errand (`errand`), such
  as the note a planning session leaves (#601, ADR 0032): Claude's Sonnet at Low, the fake's own model at Low; Codex
  has none, so a worker with only Codex writes no notes.
- **Plan usage** (#66): Claude reads it with the Agent SDK's experimental usage call (checked with Zod, as it may
  change) and hears each `rate_limit_event` a turn sees; Codex reads its rate limits and hears
  `account/rateLimits/updated`. A sign-in without plan limits (an API key) reads as none.
