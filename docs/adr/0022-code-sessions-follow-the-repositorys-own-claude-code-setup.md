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
matches the command allowlist on its parsed words. Anything else waits in the hook for the owner's approval (#171),
for as long as they take, and runs only if they allow it. The default allowlist starts with the shell commands a
model looks around with, `cat`, `ls`, `head`, `tail`, `wc`, `grep`, `rg` (never with `--pre` or `--hostname-bin`,
which run a program), `pwd` and `diff`, under the same rules as every allowed command: one at a time, naming no path
outside the worktree (#178). `find` isn't among them, since `-exec` runs anything. The package scripts are allowed
in the packages pnpm's `--filter`, `-C` or `-r` pick too, when the script alone would be, and the test tools those
scripts run are allowed run directly (`vitest run`, `playwright test`, `tsc --noEmit`, `biome check`, with `npx`,
`pnpm` or `pnpm exec`), since they run the same code the scripts do; `npx` of anything else asks, since it can fetch
and run any package (#202).

Every command runs in the foreground (#178). A turn's background commands stop when it ends, and nothing wakes the
model when one finishes, so a model that backgrounds `pnpm verify` and ends its turn waits for a message that never
comes. The adapter turns Claude Code's background tasks off (`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`), so the `Bash`
tool doesn't offer `run_in_background`, and its hook refuses a `Bash` call that asks for it anyway, before the worker
is asked, telling Claude to run it in the foreground.

Inside the worktree, the files that decide what an allowed command runs need an approval too: a `package.json` (and
the package manager's settings: `pnpm-workspace.yaml`, `.npmrc`, `.pnpmfile.cjs`), git hooks (`.husky`, `.githooks`,
lefthook's files, the folder `core.hooksPath` names), Claude Code's `.claude` folder (its settings, hooks and skills,
which the next turn loads) and git's own `.git`. Without that, a model could add a package script or a hook in one
turn and run it through `pnpm test` or `git commit` in the next.

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
  run as the repository says, as its package scripts do. Plugins it enables are never found: Claude Code looks for
  installed plugins in an empty folder of the turn's own (`CLAUDE_CODE_PLUGIN_CACHE_DIR`), so nothing installed on
  the machine comes in. Its permission rules change nothing: the hook decides every tool call, and a refusal from it
  can't be overridden. A repository whose settings change how Claude signs in (an API key helper, say) changes it for
  its own sessions. Its settings' environment could turn background tasks back on; the hook still refuses them.
- **The boundary is the worktree and the session's environment, not the code.** An allowed command such as `pnpm
  test` runs code the model wrote (a test file, say), as with any coding agent; no filter on commands can close
  that. What that code can reach is the worktree, the worker machine's user account, and the session's environment,
  which holds no login of the machine's (#99): its GitHub sign-in is Courtyard's own, limited to the repositories the
  owner installed the GitHub App on. Running code in a container is deferred (ADR 0007).
- **An approval waits, up to a point.** Claude Code's wait on the hook is a timer, and the longest one it can keep is
  about 24.8 days. An approval left unanswered that long is refused to Claude, as anything the hook doesn't allow is;
  the owner can ask the session again. Re-arming the wait isn't worth it for a gap that long.
- **Only the Claude adapter knows this.** The worker only says a turn is a code session's (its worktree and its say
  on edits and commands); Codex codes in a ticket of its own.
- **A repository's `.agents/skills`** are still found by Courtyard's skills module (ADR 0016), so a repository can
  carry skills for every provider there and Claude-only ones in `.claude/skills`.
