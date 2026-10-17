# Courtyard at a glance

Courtyard is a hub for planning and coding with AI models, with one workspace for each area of your life. This page
is the short version: what the parts are, where their code lives, and what each feature does.
[`architecture.md`](architecture.md) is the full reference.

## 1 · The whole thing

```
  📱 Web app  ◄── 📜 contract ──►  🖥️ Worker
  apps/web       packages/contract   apps/worker
```

| Part | Its job |
|---|---|
| 📱 **Web app** | Shows things and asks the worker. Keeps nothing itself. |
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
| `lib/` | Small helpers every feature reuses: files, requests, git, commands, `Result` |
| `main.ts`, `start.ts`, `worker.ts` | Start the worker and wire everything together |

The API tests are in `apps/worker/test/`, beside `src/`.

**Web app, `apps/web/src`**

| Folder | What's in it |
|---|---|
| `features/` | One folder per screen or part of one, each with its `README.md`; a big one in parts (`sessions/answer/`) |
| `components/` | Shared pieces, in groups by kind: `layout/`, `buttons/`, `forms/`, `sheets/`, `frame/`, `chat/`, `code/`, `workspace/`, `rich-blocks/` |
| `hooks/` | Shared `use…` functions (a component's own stay beside it, like `useKept` in `components/layout/kept.tsx`) |
| `api/` | Talking to the worker (each feature's own calls are in its `api.ts`) |
| `routes/` | One file per page |
| `lib/` | Small helpers: joining classes, times, words |
| `main.tsx`, `styles.css` | Start the app, and the one theme |

## 3 · The features, by job

### 🤖 Talking to the models

**Worker features:** `sessions` · `saves` · `suggested-replies` · `quick-questions` · `sources` · `limits` · `waiting`

**Web features:** `sessions` · `step-by-step`

You ask "which tyres for winter?":

```
sessions ─► prompts ─► providers ─► Claude ─► answer ─► sources, suggested-replies ─► waiting
 logs it    builds      the one      thinks    streamed   links and taps to          "new reply"
            what it     seam                   back       reply with
            reads
```

- **`waiting`** decides, once, what waits on you. Every screen reads it.

### 🗂️ What Courtyard knows

**Worker features:** `context-folder` · `context-file` · `owner-context` · `workspaces` · `things` · `documents` ·
`planning-files` · `planning-home` · `tidy` · `changes` · `attachments`

**Web features:** `home` · `planning-home` · `new-workspace` · `things` · `documents` · `changes` · `tidy` ·
`settings`

You say "swapped the chain today":

```
things ─► context-folder ─► git commit ─► backup ─► changes
updates    one change at     says what      pushed     listed with
the chain  a time            changed                   Undo
```

- **Every change to the context folder** goes through `context-folder`, so each one is a commit you can undo.

### 🛠️ Building code

**Worker features:** `code` · `tasks` · `pull-requests` · `lead` · `next-up` · `red-main` · `repos` ·
`matt-setup` · `matt-skills` · `workspace-main` · `skills` · `connections`

**Web features:** `code-home` · `tasks` · `pull-requests` · `matt-setup`

You tap Build on an issue:

```
next-up ─► code ─────────► pull-requests ─► red-main
ready,      a session on    lists its PR     after the merge,
not         its own branch  and what it      watches main's
blocked     and worktree    waits on         checks
```

- **`lead`** runs builders in the milestone's order. **`connections`** is a code workspace's GitHub and Paper.
- **`tasks`** runs a session's long commands (a dev server, a slow test run) on after its turn, and tells the model
  when one ends.

### ⚙️ Running Courtyard

**Worker features:** `live` · `notifications` · `fresh-start`

**Web features:** `live` · `notifications` · `sign-ins` · `fresh-start` · `login`

You tap Update:

```
live ─► main moved on? ─► waits for builds and turns ─► updates and restarts
```

- **`notifications`** pushes "needs your approval" and "answer ready" to your devices.

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
| `components/` | `apps/web/src/components/` |
| `hooks/` | `apps/web/src/hooks/`, or beside the component that owns it |
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

`scripts/folders` fails `pnpm check` when a folder isn't one of those above, a feature isn't listed here, a feature has
no README, or a folder holds more than 15 files, so this page can't drift from the code.

## Zoom in

- **Every feature, in detail:** its own `README.md`, which GitHub shows when the folder opens: what it does, one
  example, what it uses, what uses it, and its API or screens. [`architecture.md`](architecture.md) links them all.
- **Why it's built this way:** [`adr/`](adr/).
- **Courtyard's words:** [`GLOSSARY.md`](../GLOSSARY.md).
