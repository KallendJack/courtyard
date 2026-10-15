# Courtyard at a glance

Courtyard is a hub for planning and coding with AI models, with one workspace for each area of your life. This page
is the short version: what the parts are and what each one does. [`architecture.md`](architecture.md) is the full
reference, in the same order.

## 1 · The whole thing

```
  📱 Web app  ◄── 📜 contract ──►  🖥️ Worker
                                    ├─ agent
                                    ├─ context
                                    ├─ devflow
                                    ├─ security
                                    ├─ integrations
                                    └─ ops
```

| Part | Its job | Where |
|---|---|---|
| 📱 **Web app** | Shows things and asks the worker. Keeps nothing itself. | `apps/web` |
| 📜 **Contract** | The shapes of everything the web app and worker send each other, checked on both sides. | `packages/contract` |
| 🖥️ **Worker** | Does all the work: your login, your workspaces, sessions with the models. | `apps/worker` |

- **One machine, one address.** The worker serves the web app and its API together, behind your own HTTPS proxy.
- **Two folders hold everything kept:** the context folder (what models know about you and your workspaces, in git)
  and the data folder (Courtyard's own state: sessions, logins). Neither is inside this repo.
- **The worker is split into seven areas,** one folder each in `apps/worker/src`. Every module lives in one of them.

## 2 · The seven areas

Each area has its job, its folders, and one thing you do followed through it.

### 🤖 agent: talking to the models

`sessions` · `providers` · `prompts` · `saves` · `suggested-replies` · `quick-questions` · `sources` · `limits` ·
`waiting`

You ask "which tyres for winter?":

```
sessions ─► prompts ─► providers ─► Claude ─► answer ─► sources, suggested-replies ─► waiting
 logs it    builds      the one      thinks    streamed   links and taps to          "new reply"
            what it     seam                   back       reply with
            reads
```

- **`providers`** is the one seam: Claude, Codex and the fake look the same to everything else.
- **`waiting`** decides, once, what waits on you. Every screen reads it.

### 🗂️ context: what Courtyard knows

`context-folder` · `context-file` · `owner-context` · `workspaces` · `things` · `documents` · `planning-files` ·
`tidy` · `changes` · `attachments`

You say "swapped the chain today":

```
things ─► context-folder ─► git commit ─► backup ─► changes
updates    one change at     says what      pushed     listed with
the chain  a time            changed                   Undo
```

- **Every change to the context folder** goes through `context-folder`, so each one is a commit you can undo.

### 🛠️ devflow: building code

`code` · `github` · `pull-requests` · `lead` · `next-up` · `red-main` · `repos` · `matt-setup` · `matt-skills` ·
`workspace-main` · `skills`

You tap Build on an issue:

```
next-up ─► code ─────────► pull-requests ─► red-main
ready,      a session on    lists its PR     after the merge,
not         its own branch  and what it      watches main's
blocked     and worktree    waits on         checks
```

- **`github`** is the only place that talks to GitHub.
- **`lead`** runs builders in the milestone's order.

### 🔒 security: the edges

`workspace-files` · `allow-all`

A model asks to read a file outside its workspace:

```
workspace-files ─► follows the real path ─► outside the workspace? ─► refused
```

- **`allow-all`** decides whether a code session skips approvals for now (you chose 1 h, 4 h, 12 h or this task).
- **The rule:** a session sees only its own workspace, and anything outside a session branch needs your approval.

### 🔌 integrations: other apps

`connections` · `paper`

A code session draws a screen in Paper:

```
connections ─► paper ─► Paper's MCP server
the workspace's  reading and drawing run;
Paper file       deleting someone else's work asks you
```

- **A connection exists only in the workspaces that name it.**

### ⚙️ ops: running Courtyard

`owner` · `sign-ins` · `notifications` · `live` · `fresh-start`

You tap Update:

```
live ─► main moved on? ─► waits for builds and turns ─► updates and restarts
```

- **`owner`** is your password and device logins. **`sign-ins`** signs in to providers (Codex).
- **`notifications`** pushes "needs your approval" and "answer ready" to your devices.

### 📜 contract: the shared shapes

`packages/contract`

You send a message:

```
web app ─► Message schema ─► worker's readBody ─► the same schema checks it again
```

- **Nowhere else defines these shapes.** Types come from the schemas.

### The web app

`apps/web/src`: `routes` (the pages), `components` (shared pieces such as buttons and the page layout), and one
folder per feature (`sessions`, `things`, `code-home`, …). It shows what the worker says and does no model work.

## How it's checked and built

| Job | Tool | Run with |
|---|---|---|
| Lint and format | Biome, plus `scripts/theme` and `scripts/areas` | `pnpm check` |
| Types | TypeScript | `pnpm typecheck` |
| Tests | Vitest (in each package), Playwright (`e2e/`) | `pnpm test`, `pnpm e2e` |
| Build | Vite (web app) | `pnpm build` |
| All of it | One build at a time on the machine (`scripts/builds`) | `pnpm verify` |

These are tools, not areas: they check the app, they aren't part of it.

## Zoom in

- **Every module, in detail:** [`architecture.md`](architecture.md), in the same area order.
- **Why it's built this way:** [`adr/`](adr/).
- **Courtyard's words:** [`GLOSSARY.md`](../GLOSSARY.md).
