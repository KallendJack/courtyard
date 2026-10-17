# preview

A code session's preview (#183): one of its tasks serving a web page, reached from the phone through a port of the
worker's own (`COURTYARD_PREVIEW_PORTS`, 9901 to 9906 unless set), behind the owner's login, only while the task runs.
The app itself stays on the worker machine's localhost. The web app's side is
[`preview/`](../../../../web/src/features/preview/README.md).

**Example:** the owner taps Start preview in a session on a Vite app. Courtyard filled in `pnpm dev` from the
repository's scripts; the owner confirms it once, and the workspace keeps it. It runs as a task with `PORT` set; once
it prints `http://localhost:5174/`, the worker opens port 9901 in front of it, and Preview opens
`https://<courtyard-name>:9901/` beside the chat. The model calls `preview_screenshot` with `/` and `cover`, and the
screenshot shows in the chat.

- **Uses:** `sessions/` (the session's running tasks, the start of each one's output, Start preview's task),
  `workspaces/` (the `preview` command in `workspace.json`), `auth/owner` (the login cookie), Playwright's Chromium
  (`playwright-core`, the screenshots), the contract.
- **Used by:** `sessions/`, which tells it each task's end (its port closes) and hands it the screenshot tool's calls;
  the web app's session page.

## API

- `GET /api/sessions/:id/preview`: where it stands: `serving` (its port), `starting` (Start preview's task hasn't
  said where yet), `full` (every port in use), or `none`, with the command Start preview would run and whether the
  owner has confirmed it.
- `POST /api/sessions/:id/preview` with `{ command }`: Start preview. Needs no approval: the owner tapped it. The
  command is kept as the workspace's when it's new.

## How it works

- **Where it serves** (`index.ts`): the first `http://localhost:<port>` in the first 64 KB of a running task's output,
  its colours taken out (Vite prints the port in bold). The first task that says one is the preview.
- **The suggested command** (`index.ts`): the repository's `preview:session` script when it has one (Courtyard's own,
  whose `dev` points at the live worker), else its `dev` script, run by the package manager its lockfile names.
- **The port** (`proxy.ts`): refuses anything without the owner's login cookie, which browsers send to every port on
  an address; passes the rest to the app as if asked on its own address (its `Host`), WebSockets too, so live reload
  works. Courtyard's own cookie never reaches the app, and an app's login cookie named as Courtyard's is renamed in
  the owner's browser (`courtyard_login_preview`), so a preview of Courtyard can't log the owner out of it.
- **Screenshots** (`screenshot.ts`): a fresh headless Chromium each time, at the size asked (`PREVIEW_SIZES`), sent the
  app's own cookies the owner's browser last sent through the port, so a logged-in page shows as the owner sees it.
