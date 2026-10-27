# paper

Paper in code workspaces, the first tool connection
([ADR 0023](../../../../../docs/adr/0023-paper-is-the-first-tool-connection-in-code-workspaces.md)).

**Example:** a code session draws a new board in the workspace's Paper file. Each call is an activity in the chat,
and its screenshot shows under the answer.

- **Uses:** `providers/` (`ToolConnection`), `prompts/` (wording a failed call), `workspaces/` (the Paper settings).
- **Used by:** `sessions/`, `connections/` (`files.ts`), `designs/` (`files.ts`' `boards`), `worker.ts`.

## API

None of its own: connecting Paper is `connections/`' routes.

## How it works

- Builds the turn's `ToolConnection` from the workspace's Paper settings (`connections.paper` in `workspace.json`):
  Paper's MCP server as a command, and the worker's say on each call.
- Reading and drawing in the workspace's one Paper file run, each an activity (`used-tool`); another file, or making
  a file, is refused; deleting a node the session didn't make is an approval.
- It notes the nodes each call says it made (kept on the running session), hands each screenshot to `sessions/` to
  keep and show, and words a failed call through `prompts/`.
- `files.ts` lists the owner's Paper files and makes one, for connecting Paper from a code workspace's page (#308),
  by asking Paper's own MCP server through the MCP SDK's client: a dependency passed in (the one real one; `fake.ts`
  holds files in memory for the tests and the browser tests). It also exports a file's boards, page by page, each with
  its place and its screenshot (`boards.ts`, #522), for the Designs tab: past the 100 boards `get_basic_info` lists, the
  page's tree names the rest, and a picture over 8 MB is left out; the fake answers as Paper's tools do and draws each
  board as a small picture naming it. `client.ts` is the one MCP session both share.
