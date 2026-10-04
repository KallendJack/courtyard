# Tool connections are per workspace, and anything that changes things needs an approval

A tool connection is an MCP server the worker hands to a provider: a homelab's status server, a design app, later a
3D tool or the owner's calendar. A workspace gets only the tool connections its config names, so a session about a
garage cannot reach a homelab. Each tool connection's safe actions (ones that only look) are listed in the worker's
settings and run without asking; every other action pauses the turn for an approval naming the tool connection, the
action and its arguments. This holds in planning workspaces too: their files stay read-only to models, but an opted-in
tool connection may change things with approval, or a planning workspace could never drive a design app.

Addresses and credentials live in the worker's settings; a workspace's config holds only names, because the context
folder is a git repository with a remote.

## Considered options

- **Every tool connection in every workspace.** Rejected: one misdirected request could restart a homelab service.
- **Trusting each tool's own read or write labels.** Rejected: the tool's author sets those, not the owner.
- **A Courtyard integration per tool.** Rejected: MCP already covers the tools in question.

## Consequences

- Some tool connections only work while an app is open on the worker machine (a design app's desktop client), so
  "unreachable, and why" is a normal state to show, not a failed turn.
- A tool connection over HTTPS with a private certificate authority needs the worker to trust that authority.
