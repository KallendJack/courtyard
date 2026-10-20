# components

Courtyard's shared pieces, used on every page and safe on the first load
([ADR 0012](../../../../docs/adr/0012-courtyards-own-building-blocks-safe-on-the-first-load.md)). Pages and features
never style a raw `<button>`, `<input>` or error line themselves (AGENTS.md).

| Folder | What's in it |
|---|---|
| `layout/` | Every page's shape: `page.tsx` (pinned header, one scrolling middle, pinned footer), `scroller.tsx`, `kept.tsx` (nothing jumps in), `caps-label.tsx`, notices, problems, Home's blocks, dialogs |
| `buttons/` | Buttons, links, copy, thumb and sort buttons, a row as a button, the ⋯ menu |
| `photo/` | A photo with its parts pinned (tap, drag, hold to move), and the header's photo ring |
| `forms/` | Text fields, file pickers, error lines, selects, switches, tick boxes, segmented choices |
| `sheets/` | Sheets and what opens in them: Skills and Model, Allow all, Allowed commands, Notify me, Icon, recent sessions, Something's off |
| `frame/` | The Handheld frame round every page: its layout, rails (the right one listing the open workspace's sessions, #492), talk strip and Talk key, arranging workspaces |
| `chat/` | A session's flow: whose turn it is, the Working line, queued messages, approvals, notes, attachments |
| `code/` | Code workspaces' pieces: the repo picker, file tree, build stages, ask line, branch strip, connections |
| `workspace/` | A workspace's icon, menu and tabs, its context lines and skills |
| `rich-blocks/` | Tables, charts and diagrams Courtyard draws in answers (ADR 0021) |

How they fit together is in [`architecture.md`](../../../../docs/architecture.md#the-web-app-appswebsrc).
