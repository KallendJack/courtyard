# components

The web app's own shared pieces, used on every page and safe on the first load
([ADR 0012](../../../../docs/adr/0012-courtyards-own-building-blocks-safe-on-the-first-load.md)). Pages and features
never style a raw `<button>`, `<input>` or error line themselves (AGENTS.md). What both apps use (the page layout, the
`Scroller`, the loading piece, `Button`, the error line, Talk and the Reply box) is in
[`packages/ui`](../../../../packages/ui/README.md) (#703).

| Folder | What's in it |
|---|---|
| `layout/` | Notices, problems, Home's blocks, dialogs, the Courtyard mark |
| `buttons/` | Links that look like buttons, copy and thumb buttons, a row as a button, the ⋯ menu (web links are `packages/ui`'s) |
| `drawings/` | Kinds of things Courtyard draws itself, never a model: a mountain bike, with the places its parts go (#603), and its labels kept apart (`labels-apart.ts`, #657) |
| `forms/` | Text fields, file pickers, selects, switches, tick boxes, segmented choices |
| `sheets/` | Sheets and what opens in them: Skills and Model, Allow all, Allowed commands, Notify me, Icon, recent sessions, Something's off |
| `frame/` | The Handheld frame round every page: its layout, rails (the right one listing the open workspace's sessions, #492), arranging workspaces |
| `chat/` | A session's flow: whose turn it is, the Working line, queued messages, approvals, notes, the photo viewer |
| `code/` | Code workspaces' pieces: the repo picker, file tree, build stages, ask line, branch strip, connections |
| `workspace/` | A workspace's icon, menu and tabs, its context lines |
| `rich-blocks/` | Charts, diagrams and the blocks Courtyard draws in answers (ADR 0021); tables are `packages/ui/answer/`'s, drawn in a `RichBlock` |

How they fit together is in [`architecture.md`](../../../../docs/architecture.md#the-web-app-appswebsrc).
