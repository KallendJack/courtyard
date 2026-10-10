# Courtyard

A self-hosted place to plan projects and write code with AI models, where every area of your life keeps its own
context, so you never re-explain your space, your constraints or your stack.

- **Workspaces are folders.** One per project or area, each with a short `CONTEXT.md` split into facts, plans and ideas.
- **Context stays true.** Models save context as you chat; you see every change and can undo it, and each is a git
  commit, backed up wherever you choose.
- **Documents and Things.** A planning workspace's page also lists its Things, the kit it's about (a card each, with a
  photo, details and a dated history, filtered by have, want or replace, parts under the Thing they belong to), and
  its documents, the longer things saved from answers. Models keep Things current as you chat; you can add, edit and
  delete them yourself. Both are files in the workspace's folder, so they're backed up and undone like the rest.
- **Skills.** Ways of working a model follows, such as grilling a plan: Courtyard's own, and yours, as folders in the
  open Agent Skills format in your context folder (`.agents/skills/`, at its top or in a workspace's folder). Each
  workspace's page lists the ones it gets.
- **Your subscriptions, not per-token billing.** Claude through your own Claude Code login, with Codex on a ChatGPT plan
  for when Claude's usage limit hits.
- **Coding, planned.** Code workspaces, where a model works on its own branch while you're away, asks before anything
  risky, and you review and merge from your phone, are [milestone 7](https://github.com/KallendJack/courtyard/milestone/7).
- **Yours alone.** One owner, plain files, no database, private network only.

Status: being built, in the order of the repo's [milestones](https://github.com/KallendJack/courtyard/milestones).

## Before you start

- **A Windows PC to run the worker.** The start and update scripts are Windows-only for now; any machine is
  [#100](https://github.com/KallendJack/courtyard/issues/100).
- **Node.js 24, pnpm and git** on that PC.
- **Claude Code signed in on it** (see [Claude](#claude)), and optionally a **ChatGPT plan** for Codex.
- **A reverse proxy with HTTPS and a mesh VPN** (see [Reaching it](#reaching-it-https-and-a-vpn)).
- **Two folders outside the clone:** the context folder (your workspaces, kept in git) and the data folder (sessions,
  logins and logs).

## Setting up

### Reaching it: HTTPS and a VPN

Courtyard is for a private network only, and it needs HTTPS: phones only install a web app, or
show its notifications, from a secure address. It doesn't bundle either piece; you bring two
things you may already run:

- **A reverse proxy with HTTPS**, whose certificate your devices trust. It answers at a name such
  as `https://<courtyard-name>` and forwards to the worker at `http://<worker-address>:8787`
  (`COURTYARD_PORT`). It must pass on the name the browser asked for (the `Host` header), say
  which scheme the browser used in `X-Forwarded-Proto`, and pass streamed answers straight
  through without buffering them. Caddy does all three by default; nginx needs
  `proxy_set_header Host $host`, `proxy_set_header X-Forwarded-Proto $scheme` and
  `proxy_buffering off`.
- **A mesh VPN**, such as Tailscale, so the same name works away from home. Courtyard is never
  exposed to the public internet.

On the worker machine:

1. **Give it a fixed address**, so the proxy can always find it: reserve one for it on your router
   (often called a DHCP reservation).
2. **Let only the proxy in.** Allow inbound TCP on the worker's port from the proxy's address,
   and nothing else, so nobody on your network can reach the worker without HTTPS. Firewall
   rules that allow add up, so also remove or narrow any rule that lets Node.js in from
   anywhere: Windows creates one if you ever clicked Allow when it asked about Node.js.

#### One example: Caddy and Tailscale on a NAS

A NAS at `192.0.2.2` runs Caddy and Tailscale, and the worker runs on a PC at `192.0.2.10`.

- **Caddy**, with its own certificate authority, and its root certificate installed on each device:

  ```caddyfile
  courtyard.internal {
  	tls internal
  	reverse_proxy 192.0.2.10:8787
  }
  ```

- **DNS:** the network's DNS server (AdGuard Home, Pi-hole or the router) answers
  `courtyard.internal` with the NAS's address.
- **Tailscale** on the NAS advertises the home network as a subnet route, and a split-DNS entry
  sends `.internal` names to the home DNS server. Away from home, the phone reaches Caddy through
  the NAS and gets the same name, certificate and app.
- **On the PC (Windows)**, an inbound firewall rule for the worker's port, from the NAS only, in
  an administrator PowerShell:

  ```powershell
  New-NetFirewallRule -DisplayName "Courtyard worker" -Direction Inbound -Protocol TCP -LocalPort 8787 -RemoteAddress 192.0.2.2 -Action Allow
  ```

  Then list the rules that let Node.js in, and disable any that aren't limited to the NAS
  (`Disable-NetFirewallRule -DisplayName <name>`):

  ```powershell
  Get-NetFirewallApplicationFilter | Where-Object Program -like "*node.exe" | Get-NetFirewallRule | Where-Object { $_.Direction -eq "Inbound" -and $_.Action -eq "Allow" -and $_.Enabled -eq "True" } | Select-Object DisplayName, Profile
  ```

### The live copy (Windows)

Run the everyday Courtyard from its own clone of `main`, the **live copy**, not from a checkout
you develop in, so switching branches never changes the live app (ADR 0011). The scripts in
`scripts/live/` start it when you log on and update it when you choose.

1. **Clone `main`** somewhere that isn't your development checkout, and build it:

   ```powershell
   git clone https://github.com/<you>/courtyard <live copy>
   cd <live copy>
   pnpm install --frozen-lockfile
   pnpm build
   ```

2. **Write its settings:** copy `.env.example` to `.env` in the live copy and fill it in. Keep
   your context and data folders outside the live copy.
3. **Set it to start by itself.** This needs no administrator window:

   ```powershell
   & <live copy>\scripts\live\install-task.ps1
   ```

   It registers a task named "Courtyard worker" that runs the worker as you, with no window,
   whenever you log on, and starts it now. It runs as you so it can use your Claude Code login.
   If the worker stops, it starts again by itself. Its output goes to `worker.log` in the data
   folder (the previous one is kept as `worker.log.old`). A second task, "Courtyard update", has
   no trigger: the app runs it when you press Update. Only a worker started this way offers
   updates, so one you start yourself while developing never updates itself.

   A live copy set up before the Update button existed needs `update.ps1` run once, then
   `install-task.ps1` again, to get the second task.

A step-by-step setup checklist, on any machine, is [#100](https://github.com/KallendJack/courtyard/issues/100).

## Running it day to day

The worker starts when you log on and again if it stops (the live copy's task, above).

**To update** to the newest `main`, press **Update** on the home page when it says a new version
is ready (it checks every few hours), or run:

```powershell
& <live copy>\scripts\live\update.ps1
```

- **It refuses** if the live copy has changes of its own, isn't on `main`, or `main`'s newest
  commit isn't passing CI.
- **Otherwise it updates:** it shuts the worker down, pulls, installs the locked package versions
  and builds, then starts the worker and waits for it to answer. It shuts the worker down first
  because Windows can refuse to replace files a running worker has open. A turn running at that
  moment is recorded as interrupted.
- **If any step fails,** it puts the previous version back and starts that instead.
- **Only one update runs at a time.** If something other than the worker answers on its port,
  the update stops without changing anything.
- **The result** is written to `live-update.json` in the data folder, and the home page shows it.
  From the button, the update's output goes to `live-update.log` there too.

### Code workspaces

Being built ([milestone 7](https://github.com/KallendJack/courtyard/milestone/7)). To make a
workspace a code workspace, give its folder a `workspace.json` naming the repository on the worker
machine:

```json
{ "mode": "code", "repoPath": "/path/to/repo" }
```

- **The repository needs an `origin` remote** (its GitHub copy): each session starts its own
  branch, `courtyard/…`, from `origin`'s default branch, freshly fetched, in its own worktree in
  the data folder's `worktrees/`. Your own checkout is never touched.
- **Only a model that can code works there** (Claude, for now); others are refused, saying so.
- **Without asking,** a session edits files in its worktree and runs the command allowlist: the
  package scripts (`pnpm`/`npm` install with a frozen lockfile, check, typecheck, test, build, e2e
  and verify), git and gh commands that only look, `git add` and `git commit` on its branch,
  pushing its branch (to `origin`, under its own name, never forced), and opening or updating its
  own pull request with `gh pr create`/`gh pr edit`. Any other command, an edit outside its
  worktree, or an edit to a file that decides what those commands run (a `package.json`, git
  hooks, `.claude`) waits for you: the session shows the exact command or file with Allow and
  Deny, and waits as long as you take.
- **To change a workspace's command allowlist,** add an `allowlist` to its `workspace.json`: the
  commands to add, and the default ones to remove, each by its first words, ending ` ...` when
  more arguments may follow. A command still never chains another, nor names a path outside the
  worktree, without asking.

  ```json
  {
    "mode": "code",
    "repoPath": "/path/to/repo",
    "allowlist": { "add": ["cargo test ...", "pnpm lint"], "remove": ["npm ci"] }
  }
  ```
- **To let its sessions read and draw Paper boards** (Claude only), add Paper to its
  `workspace.json`: Paper's command on the worker machine and the one Paper file its sessions
  use, by the id at the end of the file's link in Paper. Sessions read and draw there without
  asking, ask before deleting anything they didn't make, and show each screenshot they take in
  the chat. Paper has to be open on the worker machine; when it isn't, the session says so and
  carries on.

  ```json
  {
    "mode": "code",
    "repoPath": "/path/to/repo",
    "connections": { "paper": { "command": "/path/to/paper", "fileId": "<file id>" } }
  }
  ```
- **Up to three sessions run at once** across the worker; a fourth waits, saying so, and starts
  when one ends. Each running session's commands get `COURTYARD_SESSION_SLOT` (1 to 3), no two
  the same, for the repository's checks to pick their test servers' ports from.
- **Its `git` and `gh` use Courtyard's own GitHub sign-in** (see [GitHub](#github)), never the
  worker machine's, even for a repo cloned over SSH. Until you've signed in, the workspace's page
  says its sessions can't push or open a pull request.
- **A session ends when its pull request is merged or closed,** from Courtyard or on GitHub: it
  stays readable but takes no more messages, and its worktree, its branch and the branch it
  pushed to GitHub are cleared away (once any turn still running has ended). A session deleted
  before its first turn started has its worktree and branch cleared away at once.

### Notifications

A device can buzz when a session needs your OK, and when a turn finishes or fails; tapping the
notification opens the session. It shows only the session's title and what it needs.

**To turn them on,** on each device you want them on, open the home page and switch on
**Notifications → On this device**, beside Connections, then let the browser show notifications
when it asks. Each device turns its own on and off.

- **It needs HTTPS** (see [Reaching it](#reaching-it-https-and-a-vpn)): browsers only allow
  notifications there. **On an iPhone or iPad,** add Courtyard to the Home Screen first (Share →
  Add to Home Screen, iOS 16.4 or later), and turn them on from there.
- **If you said no** when the browser asked, the switch says they're blocked: allow notifications
  for Courtyard in the browser's site settings, then turn them on again.
- **Nothing buzzes for a session you have open** in front of you on that device.
- **Logging a device out stops its notifications.** After logging in again, opening the home page
  picks them up again.
- **The worker sends them through each browser's own push service** (Google's, Apple's or
  Mozilla's), so the worker machine needs to reach the internet. Its keys are made on its first run
  and kept in the data folder's `notifications/`, with each device's subscription; if that folder
  is lost, turn notifications on again on each device.

## Settings

Every setting, and what it does, is in [`.env.example`](.env.example). Copy it to `.env` in the live copy and fill it in.

## Accounts it uses

### Claude

Courtyard talks to Claude through Claude Code on the machine its worker runs on (the Agent SDK),
so it uses whatever that machine is signed in with:

- **Your Claude plan:** log in once with Claude Code on the worker machine (`claude`, then
  `/login`). Courtyard's usage counts against your plan's limits, like Claude Code's own.
- **Or an API key:** set `ANTHROPIC_API_KEY` in the worker's environment. That's billed per token.

Courtyard never reads, stores or logs either. Anthropic doesn't let apps offer a claude.ai login
to other people, so everyone who runs Courtyard signs in with their own. Set
`COURTYARD_CLAUDE_PROVIDER=0` to leave Claude out.

Each session sees only its own workspace's folder: none of the machine's Claude Code settings,
memory, skills or connectors, and in planning workspaces it can only read.

In a code workspace (see [Code workspaces](#code-workspaces)), Claude also follows the
repository's own Claude Code setup: its `CLAUDE.md` (or the `AGENTS.md` it points to), its
`.claude/settings.json` and its `.claude/skills`, read from the session's own worktree. Still
none of the machine's own.


### Codex

Courtyard also talks to Codex, on your ChatGPT plan, so a session can carry on when Claude's
usage runs out. It uses the Codex program Courtyard installs itself (`pnpm install`), at a fixed
version, never a Codex you've installed elsewhere.

- **Courtyard's Codex home is its own.** Codex keeps its sign-in in a `codex` folder in the data
  folder (`COURTYARD_DATA_DIR`), separate from `~/.codex`, so none of your own Codex settings,
  skills, memories, plugins or connectors reach a workspace, and signing in or out of one doesn't
  touch the other.
- **Sign in from the home page,** on any device, with a ChatGPT plan. While Codex is signed out,
  the home page offers Sign in to Codex: it shows a link and a one-time code to finish in any
  browser, and carries on by itself once you have. Connections, at the foot of the home page,
  shows who Codex is signed in as, with Sign out. If ChatGPT refuses the code, switch on device
  code sign-in at chatgpt.com (Settings, Security) first. To sign in on the worker machine
  instead, in PowerShell from Courtyard's folder:

  ```powershell
  $env:CODEX_HOME = "C:\path\to\data\codex"
  pnpm --filter @courtyard/worker exec codex login --device-auth
  Remove-Item Env:CODEX_HOME
  ```

- **Codex is on unless switched off.** Without a ChatGPT plan, set `COURTYARD_CODEX_PROVIDER=0`
  to leave Codex out, or say Not now to the home page's sign-in, which it remembers.

Codex has no shell in Courtyard: it reads a workspace's files and saves to context only through
Courtyard's own tools, which the worker keeps to the workspace's folder, as it does Claude's reads.
Courtyard never reads, stores or logs its sign-in.

### GitHub

Code sessions reach GitHub through Courtyard's own sign-in, never the worker machine's `git` or
`gh` login: a **GitHub App** you register once and install on only the repos sessions may use, so
they can't reach any other. You sign in to it from Connections, on the home page, with a device
code. It needs [`gh`](https://cli.github.com) installed on the worker machine (git gets its
GitHub credentials through it). Until it's set up, a code workspace says its sessions can't push
or open a pull request.

**Register the GitHub App, once:**

1. On GitHub, open **Settings → Developer settings → GitHub Apps → New GitHub App**
   (`https://github.com/settings/apps/new`).
2. Give it a name nobody else has used ("Courtyard for <your name>"), and any homepage URL (this
   repo's, say). Leave the callback URL empty and "Request user authorization (OAuth) during
   installation" off. Leave **Expire user authorization tokens** on: Courtyard refreshes them.
3. Tick **Enable Device Flow**.
4. Under **Webhook**, untick **Active**: Courtyard asks GitHub, it isn't told.
5. Under **Repository permissions**, give it: **Contents** read and write (push the session's
   branch), **Pull requests** read and write (open, update, merge and close its PR), **Checks**,
   **Commit statuses**, **Actions** and **Issues** read-only (follow the PR's checks, read the issue
   a session works on); **Metadata** read-only is always on. Add **Workflows** read and write only
   if sessions may change the repo's `.github/workflows`. Nothing under account permissions.
6. Choose **Only on this account**, then **Create GitHub App**.
7. On the app's page, copy its **Client ID** (not the App ID), and set it in the worker's `.env`:
   `COURTYARD_GITHUB_CLIENT_ID=<client ID>`. It needs no client secret or private key. Restart the
   worker (or run an Update) to pick it up.

**Install it on the repos sessions may use:** on the app's page, **Install App**, pick your
account, choose **Only select repositories**, pick them, and **Install**. To change them later:
**Settings → Applications → Installed GitHub Apps → Configure**. Connections lists the repos it
reaches.

**Sign in from Connections,** on any device: **Sign in to GitHub** shows a code; **Copy, open
GitHub** copies it and opens github.com/login/device to enter it, and the page carries on by itself
once you've said yes. **Switch** signs in as another account (the one signed in stays until the new
sign-in finishes), and **Sign out** forgets the sign-in on the worker. To withdraw it on GitHub's
side too: **Settings → Applications → Authorized GitHub Apps → Revoke**.

**Where it's kept:** in the data folder's `github` folder: `sign-in.json` (the token, refreshed
before it runs out every eight hours, and forgotten if GitHub stops accepting it, after six months
unused) and `gh/`, the `gh` config folder code sessions use. A session's `git` and `gh` get
it there, through the environment their commands run in; it never reaches the browser, a
session's events, the context folder or a model. A fresh start keeps it.

## Getting things back

### Your context's history and backup

The worker makes your context folder a git repository the first time it starts, and commits every
change to it: a workspace added, renamed or archived in the app, and anything you edit by hand,
which it commits as "Edited by hand" before its next change (and every ten minutes). Commits are
Courtyard's own, not your git identity.

**To back it up,** set `COURTYARD_CONTEXT_REMOTE` to any git remote. Nothing needs to run there:
a bare repository in a shared folder on a NAS works (`git init --bare` in the folder, then
`//nas.example/courtyard/context.git`, signed in to once from the worker machine). The worker
pushes after every change. When a push fails, the change is still kept, the home page says how
long the backup has been behind and why, and the worker tries again after the next change and
every ten minutes. Without a remote, the home page says the context isn't backed up.


### Archived workspaces

Archiving a workspace in the app moves its folder into an `archived` folder in your context folder,
so it leaves every list but nothing in it is lost. Its sessions stay in the data folder, to read
but not carry on. **To bring one back,** move its folder out of `archived`, back into the context
folder: it reappears in the app with its sessions. No workspace can be called "archived", and a
new one can't take an archived one's folder name.


### Bringing back what a fresh start cleared

**Fresh start** (a quiet link at the foot of the home page) clears every workspace, your owner
context and every session, so Courtyard starts as on its first run. Your password, your devices'
logins and the Claude, Codex and GitHub sign-ins stay. There's no Undo button, but nothing is lost:

- **The context folder** is cleared as one change titled "Fresh start", so its history (and your
  backup) still has every file. To bring it all back, run this in the context folder, while no turn
  is running:

  ```sh
  git checkout "HEAD^{/^Fresh start}~1" -- .
  ```

  That takes the files from just before the latest fresh start, replacing any made since at the
  same paths; the worker commits them as "Edited by hand". To bring back one workspace, name its folder instead of
  `.`. Recent changes still begin at the fresh start.
- **The sessions** move to `fresh-starts/<date>` in the data folder (`-2`, `-3` and so on for a
  second fresh start the same day), and are never tidied away. To bring them back, move the session
  folders inside it back into the data folder's `sessions` folder. A session shows again once its
  workspace is back.


## Moving to a new machine

A step-by-step checklist is [#100](https://github.com/KallendJack/courtyard/issues/100). Until then: clone the context folder from its backup, copy the
data folder as it is, and sign in to Claude Code on the new machine.

## Working on it

- **Start with [AGENTS.md](AGENTS.md).** The process is [Matt Pocock's skills](https://github.com/mattpocock/skills),
  set up as `docs/agents/` says. How the parts connect is in [`docs/architecture.md`](docs/architecture.md).
- **`pnpm verify`** runs every check: lint and format, types, tests, the build (with the first-load budget) and the
  browser tests. Each git worktree's browser tests use their own ports, so copies can test side by side.
- **`pnpm dev`** runs the worker and the web app with reloading. It needs a `.env` in the clone with its own context
  and data folders, never the live ones, and its own `COURTYARD_PORT` if the live worker runs on the same machine.
- **On Windows,** some worker tests can time out while the PC is busy: [#130](https://github.com/KallendJack/courtyard/issues/130).
- **Before changing Codex's version,** run [the real-Codex check](docs/real-codex-check.md).

## Where to read more

- **What's being built:** the spec issues and [milestones](https://github.com/KallendJack/courtyard/milestones) on GitHub;
  [`docs/spec.md`](docs/spec.md) is the original spec, frozen.
- **Why it's built this way:** [`docs/adr/`](docs/adr/). **Its words:** [`GLOSSARY.md`](GLOSSARY.md).
- **What its models are told:** [`docs/ai-conduct.md`](docs/ai-conduct.md).
