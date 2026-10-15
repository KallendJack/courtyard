# A code session runs on the provider's own coding instructions, with Courtyard's appended

Amends ADR 0022, decided on #212 with the owner (2026-10-11). Code sessions felt slow and clumsy next to Claude Code
itself on the same model, and the reason was the adapter: it gave a code turn Courtyard's framing as its whole system
prompt, which replaced Claude Code's own (how to use its tools well and in parallel, when to keep a task list, git and
pull request practice, keeping answers short). It also ended a turn after 30 of Claude's round trips, and offered
neither Claude Code's task list (`TodoWrite`) nor its `Skill` tool, so Matt Pocock's skills (ADR 0024) were turned on
but couldn't be loaded.

So **a code session runs on its provider's own coding instructions, with Courtyard's framing appended unchanged.**
For Claude, that's Claude Code's `claude_code` system prompt preset with the turn's framing as its `append`. The
framing is the same text as before, built from `docs/ai-conduct.md`: the workspace, the access line (worktree,
allowlist, approvals), the house process (#205: an issue for every change, `tdd`, the narrowest check first, the `pr`
skill for every pull request, the repository's own `AGENTS.md` or `CLAUDE.md` winning where it says more), written
for any repository, never only Courtyard's. A planning turn and a one-off question are unchanged: Courtyard's
instructions alone.

A code turn also gets:

- **No turn limit.** It ends when Claude finishes, when the owner stops it, or at a usage limit. A planning turn keeps
  its limit of 30.
- **`TodoWrite` and `Skill`.** Every call still goes through the adapter's PreToolUse hook, as ADR 0022 says, and
  nothing is pre-approved: a task list update touches no file, so the hook lets it through and the session shows
  "Updated the task list"; a skill loads only if the turn turned it on. Sub-agents (`Agent`) stay off (#117; ADR 0027 turns
  them on, inside the session's boundary), and the web tools still follow the workspace's web setting.

**Codex follows the same rule when it gets code sessions:** its own coding instructions, with Courtyard's framing
appended. Nothing changes for Codex now, since it doesn't code yet (ADR 0015).

## Considered options

- **Courtyard's own framing alone, with the missing coding guidance written into it** (efficient and parallel tool
  use, task lists, git practice). Rejected: it would mean Courtyard keeping its own copy of what each provider already
  tunes for its models, always behind theirs, and sessions would code differently from the owner's own Claude Code on
  the same repository. The part that's Courtyard's (the boundary, approvals, the house process) is what it writes.
- **A higher turn limit (400, say) instead of none.** Rejected: any number stops long work mid-task to wait for the
  owner, and the owner's Stop already ends a turn.

## Consequences

- **Not every word a model reads is in `docs/ai-conduct.md` any more.** In a code session the provider's own
  instructions come first; they're the provider's, as the repository's `CLAUDE.md` and Matt's skills are (ADRs 0022,
  0024). Everything Courtyard adds still comes from the guide, the same for every provider.
- **ADR 0015's "Courtyard's instructions replace Codex's own, as they replace Claude Code's"** now holds for planning
  turns only. When Codex codes, it keeps its own coding instructions.
- **A Claude Code update can change how code sessions behave** without a Courtyard change, as it does for the owner's
  own sessions. The Agent SDK version in the lockfile decides when that reaches the live copy.
- **A turn with no limit can use more of the plan** on a task that goes round in circles; the owner sees each
  activity as it happens and can stop it.
