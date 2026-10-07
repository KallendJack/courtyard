# Codex runs through its app-server, in its own Codex home, without a shell

Changes ADR 0004's "through the Codex SDK". The Codex SDK only starts `codex exec` once per turn: answers arrive a
whole message at a time, there's no list of the plan's models, and a usage limit is an error sentence with no reset
time. The same Codex program has an app-server, the mode OpenAI's own editor extension and desktop app drive: one
long-running process the worker exchanges JSON-RPC messages with, which streams answers as they're written, lists the
plan's models and their effort levels, reports a usage limit as a code with its reset time, stops a turn, and signs
in. So the Codex adapter drives the app-server, started the first time Codex is needed and kept running.

Isolation follows ADR 0003, but Codex needs more of it. Codex reads files by running shell commands, and its read-only
sandbox stops writes, not reads, so with its shell on, a turn could read anything on the worker machine. And by
default it loads the machine's whole Codex setup: settings, skills, memories, plugins, ChatGPT connectors, `AGENTS.md`
files, browser and computer use. So every turn:

- **Its own Codex home.** The adapter points Codex at a folder in the data folder that holds only Courtyard's Codex
  sign-in, never the machine's `~/.codex`.
- **No shell.** Codex sees files only through Courtyard's own tools (list, read, search), which the worker serves and
  confines to the workspace folder with the same check as Claude's reads, symlinks followed.
- **Its extras off unless the owner chooses them.** Anything that reaches outside the workspace (connectors, browser
  and computer use, web search) or does Courtyard's job (memories, skills, `AGENTS.md`) is switched off. Harmless ones
  (image generation) are off until there's a reason and a way to show them.
- **A second layer:** the read-only sandbox, no network, and approvals set to never, so anything that would ask is
  refused.
- **Courtyard's instructions replace Codex's own,** which describe a shell and tools it doesn't have, as they replace
  Claude Code's.
- **A fresh Codex thread each turn,** with the context file and the conversation so far, as Claude gets them. The
  session's event log stays the only copy of a session.

## Considered options

- **The Codex SDK.** Rejected: no streaming, no model list, and a usage limit only recognisable by its wording.
- **Codex's shell, trusting its sandbox.** Rejected: the sandbox stops writes, not reads, and on Windows it can't be
  relied on to keep reads inside one folder.
- **Courtyard's tools as an MCP server over HTTP in the worker.** Kept as the fallback. The app-server can call tools
  its client offers (dynamic tools) over the same connection, each call naming its thread and turn: nothing new
  listens on the network and there are no per-turn secrets. That feature is marked experimental.

## Consequences

- **The app-server is marked experimental, and so are its dynamic tools.** The Codex version is pinned, every message
  from it is parsed with Zod, and only the Codex adapter knows about it, so a change shows as a clear failure and
  moving to the HTTP fallback, or to the SDK, touches nothing else.
- **Upgrading Codex is a deliberate change.** A new version can add tools that are on by default, so a version bump
  re-checks Codex's feature list against what's switched off and runs a real-Codex check. A Codex too old for
  OpenAI's servers shows as unavailable, "Codex needs updating", until then.
- **The owner signs in to Codex from Courtyard.** Codex's own home is used by nothing else, so its sign-in can lapse
  unseen. The home page offers Sign in to Codex while it's signed out: Codex gives a link and a one-time code to finish
  on any device, and keeps the sign-in in its own home. Courtyard never sees the password or the stored sign-in, only
  the link and code, which are useless once used. Claude has no equivalent: the Agent SDK has no sign-in, Anthropic
  asks third-party software not to offer a claude.ai sign-in, and the worker machine's Claude Code login is kept fresh
  by the owner's everyday use.
- **Codex is on unless switched off.** Someone running Courtyard without a ChatGPT plan dismisses the sign-in with Not
  now, or switches Codex off in the worker's settings.
- **Code workspaces need a shell** (phase 4). How Codex codes on a session branch is decided with Claude's coding,
  then.
