# Paper is the first tool connection, in code workspaces

Builds on ADR 0008 for its first tool connection (#180). A code workspace's `workspace.json` can name Paper: its
command on the worker machine and the one Paper file its sessions use, by the file's id. When it does, and the
provider uses tools (Claude), the worker hands each code turn Paper's MCP server, which the Claude adapter passes to
Claude Code as a command it starts (`paper mcp`, over its input and output) beside Courtyard's own server. Nothing else
of the machine's MCP setup comes in (ADR 0003).

The worker decides every call before it happens, through the provider seam, as it does edits and commands (ADR
0007): Claude's hook asks it about each Paper tool by the tool's own name. The rules, from the owner's grill:

- **Reading and drawing run without asking:** reading, screenshots, writing to the canvas, changing styles, moving and
  renaming. A draft is only a draft until the owner OKs it, so drawing is safe in ADR 0008's sense.
- **Deleting anything the session didn't make asks.** The worker notes the nodes each call that makes nodes says it
  made (a board, a row, a copy), and a delete naming any other node waits for the owner's approval, as an edit outside
  the worktree does (#171). The notes last while the worker runs, so after a restart deleting asks.
- **One file.** A call naming another Paper file, or none when the tool takes one, is refused, saying which file to
  use; making or renaming a file is refused. Paper's guides, its list of files and its fonts name no file, and run.
- **Paper not open is normal.** Courtyard doesn't start Paper. When a call fails, the model is told that if Paper
  couldn't be reached, Paper isn't open on the worker machine: say so, and carry on with the code.
- **Screenshots show in the chat.** Each image a screenshot gives back is kept in the session's folder and recorded
  as an `image-shown` event, which the chat shows with the same thumbnail and full-size view as the owner's photos,
  only the newest of each board.

The command is a path on the worker machine, like a code workspace's `repoPath`, not an address or a credential, so
it sits in the workspace's config; Paper's sign-in stays in Paper.

## Considered options

- **The machine's own Claude Code MCP setup** (the owner's `paper` server). Rejected: ADR 0003 keeps the machine's
  setup out, and a workspace names its own tool connections (ADR 0008).
- **Every Paper tool asks, as ADR 0008 has it by default.** Rejected by the owner: drawing a board is dozens of calls,
  and a draft changes nothing the owner relies on until they OK it.
- **The file by its name** ("Festive quill"). Rejected: every Paper tool names a file by its id, so the worker can only
  check an id.
- **Starting Paper when it isn't open.** Rejected: it's the owner's desktop app, and a code session can carry on
  without it.
- **Planning workspaces too.** Not yet: later, with tool connections for every workspace (milestone 9).

## Consequences

- Only the Claude adapter knows how Paper's server is started and its tools named; the rules are the worker's
  (`apps/worker/src/paper/`), so the fake can play Paper in tests and the real app never runs there.
- Paper doesn't document what its answers look like, so the worker reads made nodes from them carefully: an id it
  misses only means deleting that node asks. Deleting a node inside a board the session made, whose id no answer
  named, asks too.
- Paper's own text in its tools and answers reaches the model as Paper wrote it; it's Paper's, so it isn't part of
  `docs/ai-conduct.md`.
- `write_html` in its `replace` mode removes the node it replaces without asking: it's drawing, as the owner decided,
  and Paper keeps its own undo.
