# Courtyard

A self-hosted place to plan projects and write code with AI models, where every area of your life keeps its own
context, so you never re-explain your space, your constraints or your stack.

- **Workspaces are folders.** One per project or area, each with a short `CONTEXT.md` split into facts, plans and ideas.
- **Context stays true.** Models save context as you chat; you see every change and can undo it, and each is a git
  commit, backed up wherever you choose.
- **Your subscriptions, not per-token billing.** Claude through your own Claude Code login, with Codex on a ChatGPT plan
  for when Claude's usage limit hits.
- **Real coding.** In a code workspace, Claude works on its own branch while you're away, asks before anything risky,
  and you review and merge from your phone.
- **Yours alone.** One owner, plain files, no database, private network only.

Status: being built. What is being built is in [`docs/spec.md`](docs/spec.md).

## Reaching it: HTTPS and a VPN

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

### One example: Caddy and Tailscale on a NAS

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

## Running it day to day (Windows)

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

## Your context's history and backup

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

## Archived workspaces

Archiving a workspace in the app moves its folder into an `archived` folder in your context folder,
so it leaves every list but nothing in it is lost. Its sessions stay in the data folder, to read
but not carry on. **To bring one back,** move its folder out of `archived`, back into the context
folder: it reappears in the app with its sessions. No workspace can be called "archived", and a
new one can't take an archived one's folder name.

## Bringing back what a fresh start cleared

**Fresh start** (a quiet link at the foot of the home page) clears every workspace, your owner
context and every session, so Courtyard starts as on its first run. Your password, your devices'
logins and the Claude and Codex sign-ins stay. There's no Undo button, but nothing is lost:

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

## Claude

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

## Codex

Courtyard also talks to Codex, on your ChatGPT plan, so a session can carry on when Claude's
usage runs out. It uses the Codex program Courtyard installs itself (`pnpm install`), at a fixed
version, never a Codex you've installed elsewhere.

- **Courtyard's Codex home is its own.** Codex keeps its sign-in in a `codex` folder in the data
  folder (`COURTYARD_DATA_DIR`), separate from `~/.codex`, so none of your own Codex settings,
  skills, memories, plugins or connectors reach a workspace, and signing in or out of one doesn't
  touch the other.
- **Sign in from the home page,** on any device, with a ChatGPT plan. While Codex is signed out,
  the home page offers Sign in to Codex: it shows a link and a one-time code to finish in any
  browser, and carries on by itself once you have. The Models list at the foot of the home page
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
Courtyard never reads, stores or logs its sign-in. Before changing Codex's
version, run [the real-Codex check](docs/real-codex-check.md). What is being built is in [`docs/spec.md`](docs/spec.md), the vocabulary in
[`GLOSSARY.md`](GLOSSARY.md), and why it is built this way in [`docs/adr/`](docs/adr/).
