# Code sessions use the provider's own helpers inside the session's boundary

Amends ADR 0025 and #89, decided on #117 with the owner (2026-10-11, 2026-10-14). The owner builds in Courtyard day
to day, and the house process needs helpers there: `code-review` runs two side by side (standards and spec), and
`implement-spec` hands each ticket to one. ADR 0025 kept Claude Code's sub-agents off, and #89 accepted "no
Claude-only extras, such as a skill running in a sub-agent".

So **a code session's model can hand parts of a job to helpers, its provider's own sub-agents, and every helper works
inside the session's boundary.** For Claude that's Claude Code's `Agent` tool:

- **Same rules as the model.** A helper works in the session's worktree and slot. Every one of its tool calls goes
  through the adapter's PreToolUse hook, which tells it apart by the id Claude Code tags it with, and the worker
  decides its edits, commands and tool connection calls exactly as the model's (ADRs 0007, 0008). An approval it needs
  names it, and Deny tells it why, as it tells the model.
- **Only the repository's and Claude Code's own types:** general-purpose, Explore and Plan, and the repository's
  `.claude/agents` (ADR 0022). Never the worker machine's (ADR 0003). A helper doesn't start helpers of its own.
- **The session's model and effort.** Claude Code is told to put every helper on the session's model, whatever its
  type or the call names (Explore's Haiku included), and the machine's own helper model is dropped.
- **At most three at once,** and a fourth waits for one to finish rather than being refused. **None in the
  background:** a turn ends only once all its helpers have finished, and Stop stops them all.
- **One heavy check at a time per session.** Helpers share the session's folder and ports, so the builds queue runs
  one of a session's builds at a time, whatever the builds-at-once setting; the others wait, saying so.
- **The owner sees one line per helper,** named by the description the model gave it, that opens on what it did and
  its report. Its events go in the session's event log tagged with it, so a reload shows the same.
- **Only when a skill calls for helpers or the owner asks,** which the house process tells the model.

**Codex's helpers are Courtyard's own** (#470, the owner, 2026-10-17). The plan was Codex's own sub-agents, inside
the same boundary. But Codex codes through Courtyard's tools, its shell off (ADR 0029), and in the pinned Codex
(0.161) a sub-agent its `spawn_agent` starts gets none of a thread's dynamic tools, Courtyard's included, so it could
read, run and edit nothing. Codex 0.163 passes them on only behind a feature still under development. So in a Codex
code session the model starts helpers with Courtyard's `start_helper` tool: each is a fresh Codex thread the adapter
runs, on the session's model and effort, given the file and coding tools (and the use skill tool), each call asked of
its own `HelperTurn` exactly as a Claude helper's is. Everything above holds: the worker's three places, none in the
background (the tool call waits for its report), Stop stopping them, the same lines and approval cards, and a branch of
its own when the model sets `own_branch` (#395). A helper isn't given `start_helper`, so it starts none of its own.
Codex's own sub-agents stay off; once Codex passes Courtyard's tools to them as a stable setting, this can go back to
them.
A worktree and branch of its own for a helper that writes code is #395.

**#395 (2026-10-15): a helper that writes code works on a branch of its own.** When the model asks for one (Claude's
`isolation: "worktree"`), Courtyard makes the worktree itself, through Claude Code's `WorktreeCreate` hook, beside the
session's and never in the repository's `.claude/worktrees`, from the session branch's last commit; reviewers and
explorers keep sharing the session's folder. It's held to its own worktree as the model is to the session's, takes
its test ports from its folder rather than the session's slot, still runs one heavy check at a time with the
session's, counts toward the three, and pushes or opens a pull request only with the owner's OK. As it finishes the
worker commits whatever it left (without the repository's hooks) and merges its branch into the session branch; a
clash aborts the merge, keeps the branch, and tells the model to merge it itself, which the allowlist allows. A
merged branch goes at once; a kept one when the session is cleared away or deleted.

## Considered options

- **Courtyard's own helper tool, the same on every provider** (as skills are, ADR 0016). Rejected for Claude: each
  provider already tunes its own sub-agents, and a copy would always lag them; what's Courtyard's is the boundary and
  how the owner sees them, which this keeps the same. Taken for Codex (#470), whose own sub-agents can't use
  Courtyard's tools; its models aren't trained on this tool, so they may use it less fluently than their own.
- **For Codex, 0.163 with its under-development feature on, or waiting for Codex to make it stable** (#470).
  Rejected: an under-development feature can change or go without notice, and waiting leaves Codex sessions without
  the helpers the house process calls for.
- **A worktree for every helper.** Not yet: the reviewers only read, and one folder per helper is #395's.

## Consequences

- **What the model is told now allows helpers** (`docs/ai-conduct.md`, Coding), and the hook refuses any type it
  can't start with plain words.
- **Claude Code decides how a helper is run.** The hook sees each call, but not a type's own instructions; a
  repository's own helper that names its own effort in its file keeps it.
- **A turn with helpers uses more of the plan.** There's no warning before a fan-out (usage is #66); the owner sees
  each helper as it works and can stop them all.
