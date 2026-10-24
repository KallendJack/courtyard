# Courtyard at a glance

Courtyard is a hub for planning and coding with AI models, with one workspace for each area of your life. This page
is the short version: what the parts are, where their code lives, and what each feature does.
[`architecture.md`](architecture.md) is the full reference.

## 1 · The whole thing

```
  🎨 ui
  packages/ui
      │
  📱 Web app  ◄── 📜 contract ──►  🖥️ Worker
  apps/web       packages/contract   apps/worker
  🪚 Fabrication       ▲
  apps/fabrication ────┘
```

| Part | Its job |
|---|---|
| 📱 **Web app** | Shows things and asks the worker. Keeps nothing itself but a read-only copy to read offline, on a device that turns it on. |
| 🪚 **Fabrication** | A second web app, served under `/fabrication` (ADR 0036): a Build's 3D view, cut plan, buy list and chat. Like the web app, it keeps nothing, and asks only Fabrication's API. |
| 🎨 **ui** | The theme and the shared pieces the apps use (the page layout, buttons, the Reply box), so they look and behave the same. |
| 📜 **Contract** | The shapes of everything the web app and worker send each other, checked on both sides. |
| 🖥️ **Worker** | Does all the work: your login, your workspaces, sessions with the models. |

- **One machine, one address.** The worker serves the web app and its API together, behind your own HTTPS proxy.
- **Two folders hold everything kept:** the context folder (what models know about you and your workspaces, in git)
  and the data folder (Courtyard's own state: sessions, logins). Neither is inside this repo.

## 2 · The folders

Both apps use the folder names most React and Node projects use, and a feature has the same name on both sides
(`features/things/` in each).

**Worker, `apps/worker/src`**

| Folder | What's in it |
|---|---|
| `features/` | One folder per feature: what it does (`index.ts`), its part of the API (`routes.ts`) and its `README.md` |
| `providers/` | The one seam to the models: Claude, Codex and the fake look the same to everything else |
| `prompts/` | Everything a model reads, built from [`ai-conduct.md`](ai-conduct.md) |
| `auth/` | Who's allowed in and what each may do: `owner`, `sign-ins`, `allow-all`, `workspace-files` |
| `integrations/` | Other apps: `github` (the only place that talks to GitHub) and `paper` |
| `config/` | The worker's settings |
| `lib/` | Small helpers every feature reuses: files, requests, git, commands, repeating jobs, `Result` |
| `main.ts`, `start.ts`, `worker.ts` | Start the worker and wire everything together |

The API tests are in `apps/worker/test/`, beside `src/`.

**Web app, `apps/web/src`**

| Folder | What's in it |
|---|---|
| `features/` | One folder per screen or part of one, each with its `README.md`; a big one in parts (`sessions/answer/`) |
| `components/` | The web app's own shared pieces, in groups by kind: `layout/`, `buttons/`, `forms/`, `sheets/`, `frame/`, `chat/`, `code/`, `workspace/`, `rich-blocks/` |
| `hooks/` | Shared `use…` functions only this app uses (a component's own stay beside it, like `useKept` in `packages/ui/layout/kept.tsx`) |
| `api/` | Talking to the worker (each feature's own calls are in its `api.ts`) |
| `routes/` | One file per page |
| `lib/` | Small helpers: times, words, stylesheets |
| `main.tsx`, `styles.css` | Start the app, and its stylesheet: Tailwind, the theme from `packages/ui`, and which classes load later (the app loads it through `lib/app.css`, which adds `packages/ui`'s classes) |

**Fabrication, `apps/fabrication/src`**

The web app's folders, for its own screens: `features/` (each with its `README.md`), `components/`, `api/` (its calls
to Fabrication's API, `/api/fabrication`), `routes/`, and `main.tsx` with `styles.css`. `three` draws the 3D view, in
a file of its own that only a Build's page loads.

**Fabrication features:** `builds`

**Shared pieces, `packages/ui`**

What both apps use, so Fabrication (ADR 0036) looks and behaves as the web app does; what only one app uses stays in
it. Its [`README.md`](../packages/ui/README.md) lists them.

| Folder | What's in it |
|---|---|
| `theme.css` | The one theme, Handheld |
| `layout/` | The page layout, the `Scroller`, the loading piece (`kept.tsx`), the label in capitals |
| `buttons/`, `forms/`, `hooks/`, `lib/` | Buttons and the busy button, the error line, `useAction`, joining classes |
| `frame/` | What the Handheld frame offers a page, and Talk |
| `reply/` | The Reply box, its chips, model choice and attachments |

**Packages, `packages/`**

| Package | What's in it |
|---|---|
| `contract` | The shapes the apps send each other |
| `ui` | The theme and the shared pieces both apps use (above) |
| `fabrication` | Fabrication's engine: a Build's parts, cut plan, buy list and steps, worked out from its template and parameters (ADR 0036) |
| `skills` | Courtyard's own skills |
| `builds` | The machine's builds lock |
| `house` | The house standard's configs and size check |

## 3 · The features, by job

### 🤖 Talking to the models

**Worker features:** `sessions` · `saves` · `suggested-replies` · `quick-questions` · `sources` · `limits` ·
`model-defaults` · `waiting`

**Web features:** `sessions` · `limits` · `waiting`

You ask "which tyres for winter?":

```
sessions ─► prompts ─► providers ─► Claude ─► answer ─► sources, suggested-replies ─► waiting
 logs it    builds      the one      thinks    streamed   links and taps to          "new reply"
            what it     seam                   back       reply with
            reads
```

- **`waiting`** decides, once, what waits on you, and lists it from every workspace for Home's Needs you, the
  Courtyard mark's gold count and a session's Next pill. Every screen reads it.
- **`limits`** keeps each plan's usage at a glance: its meters in the Model sheet, and a gold warning from 80%.
- **`model-defaults`** keeps one default model and effort per provider (Claude on Opus 5.5 · High, Codex on
  Astra · High): the Model sheet's chips, and where a new session, a switch and Carry on go.

### 🗂️ What Courtyard knows

**Worker features:** `context-folder` · `context-file` · `owner-context` · `workspaces` · `things` ·
`projects` · `fabrication` · `move-review` · `status-line` · `documents` · `floor-plans` · `planning-files` ·
`planning-home` · `changes` · `attachments`

**Web features:** `home` · `planning-home` · `new-workspace` · `things` · `projects` · `fabrication` ·
`move-review` · `status-line` · `documents` · `changes` · `settings`

You say "swapped the chain today":

```
things ─► context-folder ─► git commit ─► backup ─► changes
updates    one change at     says what      pushed     listed with
the chain  a time            changed                   Undo
```

- **Every change to the context folder** goes through `context-folder`, so each one is a commit you can undo.
- **`floor-plans`** keeps each room's last floor plan, drawn in an answer, as a document Home shows.
- **`projects`** keeps what you carry over days (the garage into an office): its steps (who does each, done, not
  ready yet), its decisions and what's next, which Home lists with Carry on.
- **`fabrication`** keeps a planning workspace's Builds (a workbench: its template and parameters), worked out by
  `packages/fabrication` each time they're read, and serves Fabrication's API. The model's Build tool starts and
  changes them and reports the numbers code works out; a project step can own one, and opens it in Fabrication,
  whose `builds` shows it: in 3D, its cut plan, buy list, tools and steps, and a chat about it in its project's
  session.
- **`move-review`** proposes, once, where a planning workspace's guides, Plans lines and wanted Things go now
  (projects, parts, the archive), which the owner ticks on Home, each move with Undo.
- **`status-line`** builds the line under a code workspace's name, ✓ just done · ● now · ○ next, from its pull
  requests and issues.

### 🛠️ Building code

**Worker features:** `code` · `tasks` · `preview` · `pull-requests` · `lead` · `builders` · `next-up` · `red-main` ·
`version-bumps` · `repos` · `matt-setup` · `matt-skills` · `workspace-main` · `skills` · `connections` · `friction`

**Web features:** `code-home` · `builders` · `tasks` · `preview` · `pull-requests` · `matt-setup` · `friction`

You tap Build on an issue:

```
next-up ─► code ─────────► pull-requests ─► red-main
ready,      a session on    lists its PR     after the merge,
not         its own branch  and what it      watches main's
blocked     and worktree    waits on         checks
```

- **`lead`** runs builders in the milestone's order; **`builders`** keeps each one's status as things happen
  (Building, Checking, Waiting on you, In CI and the rest), which the web app's **`builders`** shows on the Builders
  board at the top of a code workspace's Home. **`connections`** is a code workspace's GitHub and Paper.
- **`version-bumps`** looks after Dependabot's PRs: a failed check re-run once, then an issue for the Lead, first in
  the order (or a flaky test's, last); still failing after the fix, it's yours.
- **`tasks`** runs a session's long commands (a dev server, a slow test run) on after its turn, and tells the model
  when one ends.
- **`preview`** shows a session's running app on your phone, through a port of the worker's own behind your login,
  and takes the model's screenshots of it.
- **`friction`** is Something's off, on every screen: it takes the screen as you see it, you say what's wrong, and a
  session in Courtyard's own code workspace files the issue.

### ⚙️ Running Courtyard

**Worker features:** `live` · `notifications` · `offline-copy` · `fresh-start`

**Web features:** `live` · `notifications` · `offline-copy` · `sign-ins` · `fresh-start` · `login`

You tap Update:

```
live ─► main moved on? ─► waits for builds and turns ─► updates and restarts
```

- **`notifications`** pushes "needs your approval" and "answer ready" to your devices.
- **`offline-copy`** is what a device keeps to read while the worker can't be reached: your context and each
  workspace's 5 latest conversations, read-only, wiped when the device logs out.

### 🔒 The edges (`auth/`)

A model asks to read a file outside its workspace:

```
auth/workspace-files ─► follows the real path ─► outside the workspace? ─► refused
```

- **The rule:** a session sees only its own workspace, and anything outside a session branch needs your approval.
  `allow-all` skips approvals for a while when you choose (1 h, 4 h, 12 h or this task).

### 📜 The contract

You send a message:

```
web app ─► the message's schema ─► worker's readBody ─► the same schema checks it again
```

- **Nowhere else defines these shapes.** Types come from the schemas, in `packages/contract`.

## If you know React or Node

| You'd look for | In Courtyard |
|---|---|
| `features/` or `modules/` | `features/`, in both apps |
| `components/` | `packages/ui/` for what both apps use, else `apps/web/src/components/` |
| `hooks/` | `packages/ui/hooks/` or `apps/web/src/hooks/`, or beside the component that owns it |
| `utils/` or `lib/` | `lib/`, in both apps |
| `pages/` or `app/` | `apps/web/src/routes/` |
| `api/` or `services/` | `apps/web/src/api/`, and each feature's `api.ts` |
| `routes/` or `controllers/` (server) | each worker feature's `routes.ts` |
| `config/` | `apps/worker/src/config/` |
| `middleware/` | the checks in `apps/worker/src/worker.ts` |
| `types/` or `schemas/` | `packages/contract` |
| `test/` or `__tests__/` | `apps/worker/test/` (API), `e2e/` (browser) |

## How it's checked and built

| Job | Tool | Run with |
|---|---|---|
| Lint and format | Biome, plus `scripts/theme` and `scripts/folders` | `pnpm check` |
| Types | TypeScript | `pnpm typecheck` |
| Tests | Vitest (in each package), Playwright (`e2e/`) | `pnpm test`, `pnpm e2e` |
| Build | Vite (web app) | `pnpm build` |
| All of it | One build at a time on the machine (`scripts/builds`) | `pnpm verify` |

`scripts/folders` fails `pnpm check` when a folder isn't one of those above (in either app or `packages/ui`), a feature
isn't listed here, a feature has no README, or a folder holds more than 15 files, so this page can't drift from the
code.

## Zoom in

- **Every feature, in detail:** its own `README.md`, which GitHub shows when the folder opens: what it does, one
  example, what it uses, what uses it, and its API or screens. [`architecture.md`](architecture.md) links them all.
- **Why it's built this way:** [`adr/`](adr/).
- **Courtyard's words:** [`GLOSSARY.md`](../GLOSSARY.md).
