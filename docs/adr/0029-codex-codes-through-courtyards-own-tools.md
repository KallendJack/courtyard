# Codex codes through Courtyard's own tools, its shell still off

Amends ADR 0015 for code sessions, and ADR 0025's line on how Codex codes. ADR 0015 kept Codex's shell off because its
read-only sandbox stops writes, not reads, and deferred code workspaces, which need a shell (#248). Codex now works
in code sessions, and its shell stays off there too. In a code session Courtyard offers it three tools of its own
beside the file tools: `run_command`, `write_file` and `edit_file` (docs/ai-conduct.md, Courtyard's coding tools).
Each call is asked of the worker first, through the same `CodeTurn` check Claude's PreToolUse hook asks (ADR 0022),
and the adapter does it only once it's allowed: it writes the file, or runs the command in the session's worktree
with the session's environment, through bash (Git for Windows' on the Windows worker), ending it and everything it
started when the turn stops. A command asked to run in the background is a task (#182), as Claude's is.

So the boundary is the one Claude's code sessions have, decided in one place: a command runs without asking only on
the allowlist, naming no path outside the worktree; an edit outside the worktree, or to what decides how commands run,
waits for the owner. The approval cards, activity lines, builds queue and Allow all (#428) are unchanged, since they
sit behind `CodeTurn`.

Codex keeps Courtyard's instructions in code sessions too (ADR 0015), with the code-session access line and house
process every coding provider gets. It reads the repository's own instructions from the worktree (its `AGENTS.md`,
else its `CLAUDE.md`), as Claude reads them (ADR 0022), and gets the repository's and Matt Pocock's skills through
Courtyard's use skill tool (ADR 0016); the skills Codex finds itself stay off. Its own sub-agents stay off: its helpers are Courtyard's `start_helper`
(#470, ADR 0027).

## Considered options

- **Codex's own shell and patches, with its approval requests answered by Courtyard** (the plan when #248 was
  grilled). Rejected while building it: Codex's approval policy that asks (`untrusted`) still runs its "known safe"
  commands (`cat`, `ls`, `grep`…) without asking, and its sandbox stops writes, not reads, so a read outside the
  worktree would never reach Courtyard's check, which refuses it for Claude. Its sandbox on the Windows worker is
  Codex's own, which Courtyard can't test. The owner chose Courtyard's tools (2026-10-16).
- **Codex's hooks**, as Claude's PreToolUse hook. Rejected: they run as commands Codex starts, so the worker would
  need a way in from outside a turn, and they cover only some of Codex's tools.

## Consequences

- **Codex codes a little less fluently than with its own shell,** since its models are trained on their own tools,
  and its instructions are Courtyard's rather than its own coding ones. ADR 0025's "Codex keeps its own coding
  instructions" no longer holds; Claude still does.
- **Codex's settings don't change between planning and code:** read-only sandbox, approvals never, shell and patches
  off, every thread fresh. Only the tools offered and the repository's instructions differ.
- **A code session can move between Claude and Codex** (Carry on, or the owner switching model), in the same worktree,
  since every turn carries the conversation so far.
