# Code sessions follow the repository's own Claude Code setup

Amends ADR 0003 for code workspaces. ADR 0003 turns off everything Claude Code would load from the worker machine, so
a planning turn sees only its workspace. A code session needs one part of that back: the repository's own
instructions and skills, so it works the way the owner's sessions on that repository already do (its `AGENTS.md` or
`CLAUDE.md`, and Matt Pocock's process, ADR 0018). So in a code session, and only there, the Claude adapter gives
Claude Code the **project** settings source in the session branch's worktree: the repository's `CLAUDE.md` (and the
`AGENTS.md` it points to) and its `.claude/settings.json`, with only the repository's own skills (`.claude/skills/`)
enabled by name. The house skills come as they do on every turn, through Courtyard's use skill tool (ADR 0016).

Everything else stays off as ADR 0003 says: the machine's user and local settings, user `CLAUDE.md`, auto memory, the
claude.ai connectors and any MCP server Courtyard doesn't pass in (the repository's `.mcp.json` included). The working directory is the session
branch's worktree (ADR 0007), so the project source is read from the session's own copy of the repository, never the
owner's checkout.

Edits and commands go through the same check as every other tool call: the adapter's PreToolUse hook asks the worker
about each one, and nothing is pre-approved. An edit is allowed only inside the worktree, and a command only when it
matches the command allowlist on its parsed words. Anything else is refused with the reason for now; approvals replace
the refusal next (#171).

## Considered options

- **Keep every setting source off, and put the repository's instructions in the framing ourselves.** Rejected: it
  would mean Courtyard re-implementing how Claude Code reads `CLAUDE.md` (imports, nested files) and its skills, and
  sessions would follow the repository differently from the owner's own.
- **The user settings source too, for the owner's installed plugins (Matt's skills).** Rejected: it brings the
  machine's whole personal setup (memory, connectors, other plugins) into every code workspace, which ADR 0003 keeps
  out. Carrying the house process into code sessions is #88.
- **`skills: "all"`.** Rejected: it enables whatever Claude Code discovers, which can be more than the repository's
  own. The adapter names the repository's skills instead.

## Consequences

- **The repository's settings come with it.** Its `.claude/settings.json` can define hooks and other settings, which
  run as the repository says, as its package scripts do, and plugins it enables that are installed on the machine
  could bring theirs (their skills stay hidden, since only the repository's are named). Its permission rules change
  nothing: the hook decides every tool call, and a refusal from it can't be overridden. A repository whose settings
  change how Claude signs in (an API key helper, say) changes it for its own sessions.
- **Only the Claude adapter knows this.** The worker only says a turn is a code session's (its worktree and its say
  on edits and commands); Codex codes in a ticket of its own.
- **A repository's `.agents/skills`** are still found by Courtyard's skills module (ADR 0016), so a repository can
  carry skills for every provider there and Claude-only ones in `.claude/skills`.
