# Architecture

How Courtyard's parts fit together: a map for the owner and for any model working on this repo. What Courtyard does is
in the spec issues on GitHub (the original is [`spec.md`](spec.md), frozen), why it's built this way is in [`adr/`](adr/), and how to run it is in the
[README](../README.md). This map names the parts and how they connect, and links to those for the rest.

[AGENTS.md](../AGENTS.md) (Process) says when a PR updates this map.

## The big picture

Courtyard is two parts. The **web app** is what the owner opens in a browser: it shows things and asks the worker,
and keeps nothing itself. The **worker** does everything else: it checks the owner's login, keeps the context folder
and the data folder, and runs sessions by talking to providers. Both run from one machine, and the owner reaches them
through their own HTTPS proxy ([ADR 0001](adr/0001-the-worker-owns-everything-the-web-app-is-static-files.md),
[ADR 0002](adr/0002-one-owner-private-network-https-through-the-owners-proxy.md)).

```mermaid
flowchart LR
  subgraph device["Owner's phone or computer"]
    browser["Web app, in a browser"]
  end
  proxy["Owner's HTTPS proxy"]
  subgraph machine["Worker machine"]
    worker["Worker<br/>apps/worker"]
    built["Web app's built files<br/>apps/web/dist"]
    context[("Context folder<br/>git")]
    data[("Data folder")]
    claude["Claude Code<br/>through the Agent SDK"]
    codex["Codex app-server<br/>in its own Codex home"]
    fake["Fake providers<br/>tests and trying it out"]
  end
  backup[("Backup<br/>any git remote, such as<br/>a shared folder on a NAS")]
  anthropic["Anthropic<br/>owner's Claude plan"]
  openai["OpenAI<br/>owner's ChatGPT plan"]

  browser -- "pages, /api, events" --> proxy --> worker
  worker -- serves --> built
  worker --> context
  worker --> data
  worker -- "provider seam" --> claude & codex & fake
  context -- "pushed after every change" --> backup
  claude --> anthropic
  codex --> openai
```

- **One origin.** The worker serves the web app's built files and its API (under `/api`) at the same address, so the
  browser never talks to anything else.
- **Two folders hold everything kept.** The context folder is what models know about the owner and their workspaces;
  the data folder is Courtyard's own working state (sessions, logins, sign-ins). Neither is inside this repo.
- **Providers sit behind one seam.** Claude, Codex and the fakes look the same to the rest of the worker. Claude and
  Codex run on the owner's own subscriptions.

## The parts

The worker is split into modules, one folder each: `index.ts` is what the module does and `routes.ts`, when it has
one, is its part of the API. `worker.ts` builds every module from the settings and wires them together. The web app is
pages (`routes/`) built from feature folders and shared pieces. The contract package sits between them.

### The worker: `apps/worker/src`

**Starting up**

- **`main.ts`, `start.ts`:** start the worker: build it, then serve it on its port, or say which setting is wrong.
  Idle connections stay open longer than the owner's proxy keeps them, so the proxy never reuses one the worker
  has closed (#204).
- **`settings.ts`:** reads and checks the worker's settings from the environment.
- **`worker.ts`:** builds every module and wires them together. Every API request passes its checks (body size,
  same-site JSON only, and logged in, apart from logging in itself). It also holds the routes for workspaces, the
  owner context, backup status and live updates, and serves the web app's files.

**The owner**

- **`owner/`:** the owner's password, each device login, and slowing down wrong guesses. Its routes are setup, login,
  logout, and the login check every other request goes through. Keeps its files in the data folder.

**Context**

- **`context-file/`:** reads a context file or the owner context into its sections, puts line labels on it for a
  model, and adds, changes or removes one line. It also picks out the plans that name a day from today to 7 days on
  (`plansDue`: `2026-10-18`, `18 Oct` or `Oct 18th`, a day without its year being the next to come), which a
  planning workspace's answer (`GET /api/workspaces/:id`) gives as `duePlans` for its Home's Next up (#300), today
  being the worker's clock's. Text in, text out: it never touches the disk.
- **`workspaces/`:** the list of workspaces: reads, creates, renames and archives workspace folders, and keeps each
  one's icon (#210): the one the owner picked, or else the one its name suggests (`icons.ts`: a word match, `code` for
  a code workspace, else `book`), kept in its config when it's added. Uses `context-file/` to read each `CONTEXT.md`.
  A code workspace has none (ADR 0026): its name, its one line (`description`) and its connections are in its
  `workspace.json`, and one kept from before is read only for its title and intro line until the config has them.
  A new planning workspace's starter context file has no intro line unless the owner gave one, and the hint older
  starters wrote there is read as none and left out of what models read (`withoutStarterHint`, #300).
  It keeps the Paper file connected from the page in the config's `connections` (`connectPaper`, #308). It lists
  the workspaces planning ones first, then code ones, each group in the owner's order (#321): one list of ids in
  `workspace-order.json` at the context folder's top, kept by `arrangeWorkspaces` (`PUT /api/workspaces/order`), which
  refuses an order that mixes the groups. A workspace the order doesn't name goes at the end of its group, by name.
- **`owner-context/`:** reads `OWNER.md` and starts a new one.
- **`context-folder/`:** the context folder as a git repository. Makes changes one at a time, each kept as a commit
  that says what kind of change it is. Commits hand edits, pushes to the backup, and reads the history back for Recent
  changes and Fresh start. Every module that changes the context folder goes through it. A change made file by file
  rather than line by line (a document's or a Thing's) names its files in `Courtyard-File` trailers, so
  `wholeFilesOf`, `stillAsLeft` and `undoWholeFiles` can read it back and undo it (as bytes, so a photo goes back as
  it was); `WHOLE_FILE_FOLDERS` are the workspace folders Recent changes looks in besides `CONTEXT.md`.
- **`documents/`:** a planning workspace's documents (ADR 0020): lists, reads, saves, renames and deletes them, each
  write one change through `context-folder/`; Save as document's text from an answer; and one turn's document tool,
  which keeps what the model has read so an update to a document it hasn't read, or one changed since, is refused.
  Its routes are a workspace's documents and each document (`/api/workspaces/:id/documents/:slug`).
- **`things/`:** a planning workspace's Things (ADR 0020): reads each `things/<slug>.md` against the contract's
  schema (listing a file that fails with its problem), lists them with each part after its Thing, adds, changes and
  removes one as one change through `context-folder/` (its photo with it), keeps a photo resized with `sharp`
  (`keptPhoto`), and one turn's Things tool, which labels the Things as the turn showed them and refuses a change to
  one changed since. Its routes are a workspace's Things, each Thing, and its photo
  (`/api/workspaces/:id/things/:slug/photo`). Add Thing and Edit send a photo picked in the form
  with the fields, as one multipart form, so both are one change with one Undo; these and the
  photo's route are the only multipart requests besides a message's (`THING_PHOTO_ROUTES`).
- **`planning-files/`:** what `documents/` and `things/` share: a planning workspace's folder (or why it has
  none), a file's name from what it's called, a path from the context folder's top and back, and the change note that
  names a change's files; and for their routes (`routes.ts`), the workspace and file a path names, and the answers
  for the refusals they share.
- **`saves/`:** checks a model's save and writes it as a change; the owner's Undo and Edit from a save's note. Uses
  `context-file/` and `context-folder/`.
- **`changes/`:** Recent changes: lists a file's changes from `context-folder/`'s history, and its documents' and
  Things', and undoes one from that page (a model's document or Thing save through its session, as a save is).
- **`tidy/`:** asks a model for a shorter file, holds the proposal until the owner saves it, then saves the ticked
  changes as one change.

**Models and sessions**

- **`providers/`:** the provider seam. `index.ts` says what every provider does (its status, its models, one turn,
  one-off questions, a sign-in when it has one). Behind it are three adapters: `claude.ts`, `codex.ts` and `fake.ts`.
  Claude and Codex keep their status with `createStatusKeeper` (#282): a good answer for a minute, one saying they
  can't be used for a few seconds, the last good one through a check that gets no answer in time, and a finished
  turn counts as a good check.
- **`limits/`:** wraps every provider so it remembers a usage limit until its reset time and shows it on that
  provider's models.
- **`prompts/`:** everything a model reads, built from [`ai-conduct.md`](ai-conduct.md): each turn's framing
  (instructions with the documents and Things lists, the skills list and the skills in use, the conversation so
  far, and Courtyard's tools: the save tool, the document tool, the Things tool, use skill and suggest replies), the replies to Courtyard's
  tools, and the text for Tidy and titling a session.
- **`skills/`:** a workspace's skills (ADR 0016), worked out in one place, the more specific winning by name: the
  workspace's own `.agents/skills` in the context folder, a code workspace's repo's, the context folder's top-level
  one, in a code workspace Matt Pocock's from `matt-skills/` (ADR 0024, each marked for the picker or not), then the
  house skills for its kind of workspace from `packages/skills`. It keeps each
  skill's source, skips a broken one with why, keeps one with scripts out of a planning workspace, and answers the use
  skill tool: a skill's `SKILL.md`, or one of its files, confined to its folder.
- **`matt-skills/`:** Matt Pocock's skills for code workspaces
  ([ADR 0024](adr/0024-code-workspaces-load-matt-pococks-skills-as-a-plugin-from-a-pinned-copy.md)): fetches the
  release `packages/skills/matt.json` names from his plugin list into the data folder, keeping only his `plugin.json`,
  licence and the skills it lists, and gives the copy (`copy()`) only when it matches the pin's checksum
  (`mattChecksum`), or why not; a failure is tried again after five minutes. Fetching is a dependency passed in
  (`fetchFromGitHub`, git at his release's tag, the one real one). `sessions/` hands a code turn the copy as its
  `CodePlugin`, with the skills of it the workspace can use, and leaves them out of Courtyard's own skills list.
- **`matt-setup/`:** the setup check (#181): what a code workspace's repository is missing of what Matt's
  `setup-matt-pocock-skills` writes for the house answers (`docs/agents/` files and the Agent skills section, read
  from the default branch on its remote through `code/`, and the triage labels through `github/`), offered once.
  Allowed, it makes the labels and puts the files, from his templates in the pinned copy, on a branch of their own
  in a worktree in the data folder, pushes it and opens its pull request. Its routes are a workspace's `matt-setup`.
- **`suggested-replies/`:** checks the replies a model suggests with the suggest replies tool (ADR 0017): two or
  three, each a few words on one line, all different, one set per answer; once they're taken, keeps what the answer
  writes after them apart from lines it repeats.
- **`sources/`:** a turn's sources (ADR 0019), worked out the same way for every provider: the pages its answer
  links to and the pages the model read, each with its site's name and title; when it used none, the search results
  of a provider that gives them (Claude), those whose site the answer names or else all of them, each search's top
  results first, at most 20. Also finds the web addresses in the owner's messages, the only pages besides search
  results that Claude may read.
- **`sessions/`:** sessions as event logs. Starts and runs turns through a provider, answering each call to
  Courtyard's tools by name (one `callTool` on the provider seam, so a new tool needs no adapter change). A new tool
  is a name in `TurnToolName` (`providers/`), its definition beside its replies in `prompts/`, its answer in the
  turn's `answers` (which the compiler asks for), and a scripted line for the fake. It follows each
  one live from any position, and handles Stop, Carry on, titles, and Undo and Edit of saves. It queues a message
  sent while a turn runs and sends it once the turn ends (#177), and its list of a workspace's sessions says whose
  turn it is in each (#179). Its routes include the event stream, the
  list of models, Get to know (a session started with its house skill), Grill this plan, each attachment
  (`GET /api/sessions/:id/attachments/:attachment`), Save as document (`POST /api/sessions/:id/documents`), Undo
  of a document save (`POST /api/sessions/:id/documents/:save/undo`) or a Thing save
  (`POST /api/sessions/:id/things/:save/undo`), and removing a queued message
  (`DELETE /api/sessions/:id/queued/:queued`).
- **`code/`:** code sessions' git and what they may do
  ([ADR 0007](adr/0007-code-sessions-work-on-a-session-branch-in-its-own-worktree.md)). Starts a session's session
  branch (`courtyard/<start of its id>`) from the default branch on the repository's remote (`origin`, standing in
  for GitHub), freshly fetched, in its own worktree in the data folder, so the owner's checkout is never touched; or
  says why it can't (the repository missing, not git, or its remote unreachable). Decides each edit (inside the
  worktree once symlinks are followed; a file that decides what allowed commands run, such as a `package.json`, git
  hooks, `.claude` or git's own `.git`, needs an approval) and each command: `allowlist.ts` is the
  command allowlist, matched on the command's words once its quotes are read (the contract's `wordsOf`), never on
  the start of its text, so a
  command that chains, pipes, redirects or substitutes never matches; one naming a path outside the worktree is
  refused, and committing, pushing and the session's own PR need the worktree on the session branch. The default
  allowlist is the shell commands that look around the worktree (`cat`, `ls`, `grep`, `rg` and the like; #178), the
  package scripts (in the packages pnpm's `--filter`, `-C` or `-r` pick too, when the script alone would match) and
  the test tools they run, run directly (`vitest run`, `playwright test`, `tsc --noEmit`, `biome check`; #202), git
  and gh commands that only look, adding and committing, pushing the session
  branch (only to `origin`, under its own name, never forced) and `gh pr create`/`gh pr edit` on the session's own
  PR (#172); their flags are read, so one naming another branch, repository or PR, or one it doesn't know, asks.
  It also files, edits, comments on and closes the repository's issues and makes and lists its labels, never naming
  another repository, and reads through `gh api` with GET only (#181), and downloads a run's artifacts with `gh run
  download -D` into a folder git ignores that isn't a setup path, which `code/` checks with `git check-ignore` (#202). A backslash at a line's end joins the next
  line on, and a title, body, message or jq filter is checked as a path only as a whole, so a link in it doesn't ask
  (#202).
  A code workspace's `workspace.json` can add commands to it and remove default ones (`allowlist: { add, remove }`,
  read by `workspaces/`, built by `allowlistFor`). `sessions/` hands each code turn a `CodeTurn` (`providers/`), the
  worker's say on every edit and command, which records each one allowed as an activity and words each refusal
  through `prompts/`, and the environment its commands run in, with Courtyard's GitHub sign-in from `github/` (the
  module's own fetch from the remote uses it too). `slots.ts` keeps up to six code sessions running at once across the worker (#174, #364), each
  turn holding a numbered slot no other running one holds; its commands get it as `COURTYARD_SESSION_SLOT`, which
  this repository's Playwright config picks its ports from, so side-by-side checks never share them. A turn beyond
  three waits, first come first served, until one ends. `builds.ts` is the builds queue (#281): the heavy checks
  `allowlist.ts`'s `isBuild` picks out (the package scripts `verify`, `test`, `e2e` and `build`, in any packages
  pnpm's workspace options pick, and `vitest run` and `playwright test`, run bare or through `pnpm exec`, `npx` or
  `pnpm --filter … exec`) run up to `COURTYARD_BUILDS_AT_ONCE` at a time (1 by default) across every session, the
  rest waiting first come first served. That order lives in the worker's memory only; the build at its front then
  takes a place in the machine's builds lock (`packages/builds`, #306), which the repo's own scripts take too, so
  sessions also wait behind builds started outside Courtyard, and those behind sessions. The
  module also finds a session branch's pull request on GitHub (the repository named by its remote's address) and
  clears a session's worktree and branch away, and, once its PR is merged or closed, the branch it pushed to GitHub
  (only a `courtyard/…` one).
- **`paper/`:** Paper in code workspaces, the first tool connection
  ([ADR 0023](adr/0023-paper-is-the-first-tool-connection-in-code-workspaces.md)). Builds the turn's
  `ToolConnection` (`providers/`) from the workspace's Paper settings (`connections.paper` in `workspace.json`,
  read by `workspaces/`): Paper's MCP server as a command, and the worker's say on each call. Reading and drawing in
  the workspace's one Paper file run, each an activity (`used-tool`); another file, or making a file, is refused;
  deleting a node the session didn't make is an approval. It notes the nodes each call says it made (kept on the
  running session), hands each screenshot to `sessions/` to keep and show, and words a failed call through
  `prompts/`. `files.ts` lists the owner's Paper files and makes one, for connecting Paper from a code workspace's
  page (#308), by asking Paper's own MCP server through the MCP SDK's client: a dependency passed in (the one real
  one; `fake.ts` holds files in memory for the tests and the browser tests).
- **`connections/`:** a code workspace's connections (#308): GitHub (its repository on GitHub and whether
  Courtyard is signed in) and its Paper file, as its page's connections line and Connections sheet show them and as
  each of its turns is told them (`sessions/` gets `of`). Lists the owner's Paper files and connects one, or makes
  one named after the workspace, as one change through `context-folder/`. Paper's command is the workspace's own,
  else the `COURTYARD_PAPER_COMMAND` setting, else the one another code workspace names. Its routes are a
  workspace's `connections`, `connections/paper/files` and `connections/paper`.
- **`next-up/`:** a code workspace's Next up (#301): its repository's open `ready-for-agent` issues through
  `github/`, less those claimed (a comment starting "Building this" that no later "Stopped" released, or an open
  pull request that closes it), in
  milestone order (the number a milestone's title leads with, then Later, then none) and, inside a milestone, the
  order its description's `Build order:` line lists, the rest by number (#336), asked of GitHub only when a
  page asks and kept two minutes. Build (#298) asks again, starts a code session through `sessions/` whose first
  message is the issue (`buildIssueMessage`, worded by `prompts/`) and comments the claim on the issue, naming the
  session's branch. Its routes are a workspace's `next-up` and `next-up/:number/build`.
- **`workspace-main/`:** a code workspace's main, for its Home's Main row (#301): the default branch's newest
  commit, freshly fetched through `code/`, and its build as `github/`'s `mainBuild` reads it (#249), kept a minute
  (15 seconds while it runs), and whether the repository is the one the live copy runs from. Its route is a
  workspace's `main`.
- **Following a pull request** (#172): `sessions/` looks at each code session's PR through `code/` and `github/`
  every 30 seconds (a repeating job) and as soon as a turn in one ends, one session at a time, and records each change
  as a `pull-request` event (its number, state, latest commit and checks), which the session page's branch and PR
  strip shows. Checks failing on a commit not yet asked about start a turn on the model the owner last used, once
  the session is free: its message is the worker's (`checksFailed` on it, worded by `prompts/`), and the failed
  checks open its activity. A PR merged or closed, anywhere, ends the session: it takes no more messages, and once
  no turn runs its worktree and branch are cleared away. Each `pull-request` event carries the PR's size (lines
  added and removed, files changed, #160), which the strip shows too, its title (#240), and whether it conflicts
  with its base (#278). A code workspace's list
  of sessions gives each one's branch and its PR as last recorded (kept in memory once read, so the list doesn't
  read every event log), which the workspace page's pull requests list shows (#240).
- **Reviewing a pull request** (#160): `/api/sessions/:id/pull-request` answers with the session PR's review,
  asked of GitHub through `code/` and `github/` each time: its checks by name, its description as the session wrote
  it (#240), the files it changes with their diffs, and whether it can merge, or why not in the owner's words (checks running or failed, or a conflict with its
  base). `pull-request/merge` takes the head commit the browser reviewed and refuses when the PR has moved since
  ("The pull request changed since you looked. Review it again."), or with that reason; else GitHub merges only that
  commit. `pull-request/close` closes it. Either then follows the PR at once, so the session ends as one merged or
  closed on GitHub does. `pull-request/bring-up-to-date` (#278) fetches the PR's base through `code/` and sends
  the session the worker's message to merge it in (`bringUpToDateMessage`, worded by `prompts/`), on the model the
  owner last used there, or queues it while a turn runs.
- **`pull-requests/`:** a code workspace's pull requests, whoever opened them (#278). Lists every open one on its
  repository through `code/` and `github/`, latest first, each with who it's from: the session on its branch
  (which keeps its link), a Claude Code helper (its description signed "Generated with Claude Code"), or its
  author on GitHub; while GitHub can't be asked, its sessions' open ones as last recorded. One no session opened
  is reviewed, merged and closed by its number (one a session is on goes through that session, so it ends as
  usual), and the ask line or Bring up to date on it starts a session on its own branch (`code/`'s
  `startOnBranch`, leaving the branch on GitHub, since it isn't a `courtyard/…` one). A branch of that name the
  repository has already (#326) is brought up to its remote and used when it's checked out nowhere and has nothing
  the remote lacks, and the session remembers it didn't make it, so clearing the session away leaves it; otherwise
  the start is refused, saying which. Its
  routes are a workspace's `pull-requests`, `pull-requests/:number` with its `merge`, `close` and `sessions`.
- **`waiting/`:** what waits on the owner (#334; AGENTS.md), decided here once for every screen and device, with no
  I/O of its own. A session waits for its approval while one is asked for, else as a **new reply** while its latest
  answer (the last turn that completed or failed) is under a day old, no turn runs or waits for a slot, it has no
  pull request, and the owner hasn't **seen** it: the session page tells the worker the last event it showed once
  no turn runs and it's in view (`POST /api/sessions/:id/seen`), kept as `seen.json` in the session's folder, never
  going back; Mark all read sees every session in a workspace up to its latest answer
  (`POST /api/workspaces/:id/seen`, #345). An open pull request waits for its conflict, its failing checks (unless its session is working on
  them, #172), or a merge once its checks pass. `sessions/` puts a session's on each listed session (`waiting`),
  keeping its latest answer in memory (from its event log once recovered, then as each is written), and
  `pull-requests/` puts a pull request's on each open one; the web app reads only those (a Home tile names the
  newest session waiting, and every session list marks those waiting and puts them first, #345).
- **`attachments/`:** the photos and PDFs sent with a message (#78): checks each again as the browser did (Zod for
  its kind, size and the count, then that its first bytes are that kind), pulls a PDF's text out with `unpdf` and
  refuses one with none, keeps them in the session's folder, and gives each turn the session's last ten.
- **`sign-ins/`:** signing in to the providers whose sign-in Courtyard handles (Codex), and remembering the owner's
  Not now.
- **`github/`:** the only place that knows GitHub (#99). Courtyard signs in through a GitHub App the owner registered
  and installed on the repos they chose: a device code from Connections, then the token kept in the data folder,
  refreshed by a repeating job before it runs out, and forgotten when GitHub stops taking it. GitHub itself is a
  dependency passed in (`api.ts`, the one real one; `fake.ts` holds it in memory for the tests and the browser
  tests). It builds what a code session's commands get on top of their environment (`commandEnv`): `gh` reading
  Courtyard's own config folder, git's credential helpers replaced by `gh`'s and GitHub's SSH addresses turned to
  HTTPS, and every variable naming the machine's own login unset. While no one is signed in, that folder holds a
  stand-in that works nowhere, since `gh` would otherwise fall back to the machine's keyring. It reads a branch's
  latest pull request and the checks on its latest commit (#172), the files it changes with their diffs, and
  merges and closes it (#160); reads a pull request by its number and lists a repository's open ones, with each
  one's branch, author and whether it conflicts (#278); lists and makes a repository's labels and opens a pull request (the setup
  check, #181); lists a repository's open issues with a label, with their milestones and comments, and its open
  pull requests' titles and descriptions, and comments on an issue (Next up and Build, #301); lists the repos the GitHub App reaches, with each one's description and where git
  clones it from (#258); and reads main's build from the checks on a commit (#249): the latest try of each
  job in the order the workflow started them, the failed one's page, and when a running one should end
  from how long the build before it took. Its routes are
  `/api/github` and its `sign-in`, `cancel` and `sign-out`.
- **`repos/`:** the owner's GitHub repos as code workspaces (#258). Lists the repos `github/` gives,
  newest pushed first, each marked added when a code workspace works on it already (its repository is
  that repo's folder here, or its `origin` is that repo on GitHub, read through `code/`), the added ones
  last. For New workspace → Code, gets a picked repo onto the worker machine, one at a time: a clone
  into the data folder's `repos/<owner>/<name>` with the environment `github/` gives code sessions, so
  git asks Courtyard's sign-in through `gh` and no token is kept in the address or git's settings; a
  copy already there is used as it is. It refuses a repo the GitHub App doesn't reach or that a code
  workspace works on already. Its route is `/api/github/repos`; `POST /api/workspaces` with a `repo`
  checks the name is free, places the repo, then makes the workspace on it (`workspaces/` writes
  `{ mode: "code", repoPath }`).
- **`notifications/`:** web push to the devices the owner turned notifications on for (#173). The worker's own keys
  (VAPID) are made on its first run; each device's subscription is kept by its device login, so a device that logs
  out gets no more, and one whose subscription has gone is forgotten. `sessions/` tells it of each approval asked
  for and each turn's end (its `notify` option); an approval, a finished turn and a failed one each send one
  notification, carrying only the session's title, what it needs and the session's id. The sender is a dependency
  passed in (`web-push.ts`, the one real one, through the `web-push` package; `fake.ts` keeps what was sent for the
  tests and the browser tests). Its routes are `/api/notifications` (the public key) and its `on` and `off`.

**Running Courtyard**

- **`fresh-start/`:** clears the context folder, sets every session aside, and drops any tidy waiting for review.
- **`live/`:** for the live copy only: whether `main` has moved on, starting an update, and how the last one went
  ([ADR 0011](adr/0011-the-live-worker-is-its-own-copy-of-main-started-at-log-on.md)). While main has moved on, it
  also gives main's build (#249): CI on main's newest commit, asked of GitHub through `github/` (on the repository
  the live copy's remote names, read through `code/`) only when a page asks for the live status, at most every 10
  seconds while it runs and once a minute otherwise; none when no one is signed in to GitHub.

**Helpers**, to reuse before writing a new one (AGENTS.md):

- **`http.ts`:** reads a request's body with a contract schema (JSON with files as a multipart form,
  `readWithFiles`: a message's attachments with `readMessage`, a Thing's photo with its form), and turns errors into
  answers.
- **`files.ts`:** reads, writes (making the folder, with `writeTextFileIn`) and removes files, and JSON checked with
  a schema.
- **`git.ts`:** runs git, never stopping to ask for a password.
- **`result.ts`:** the `Result` type.
- **`testing.ts`:** a worker on temporary folders, and helpers for the tests and the context eval.

Beside `src/`, **`apps/worker/eval/`** is the context eval (see [The AI setup](#the-ai-setup)).

### The web app: `apps/web/src`

- **`main.tsx`** starts the router, which moves the scroll only for a move to another page (to the top, or back
  to where that page was), never when a page reloads its data (#168). **`routes/`** holds one file per page (TanStack Router; `routeTree.gen.ts` is
  generated). `__root.tsx` checks the worker is reachable; `_app.tsx` is the layout behind the login, with the
  workspaces down the side or across the top; the rest are pages. `_app/index.tsx` is the home page (#102), the
  workspaces as tiles; `_app/settings.tsx` is Settings, with everything that used to be on the home page besides
  them (the owner context, the backup notice, the sign-ins and Connections, Fresh start, logging out other
  devices), in the sidebar on a desktop and behind the frame's Settings sheet on a touch screen. Behind the login a page scrolls on its raised
  panel, never the window (#266), so the sidebar or the Handheld frame stays put and the scroll bar sits on the
  panel's edge: `components/page-scroll.ts` hands the panel to whatever follows the scroll (a session's turns), and
  names it to the router, which keeps its scroll per page.
- **`worker.ts`** is how the web app asks the worker: every answer is parsed with the contract's schemas, and an
  offline worker or a refusal comes back as a value to show. A page load waits for a slow worker (`untilAnswered`):
  it's tried again quietly for 30 seconds, and only a refused connection, a network that's down or that long without
  an answer counts as unreachable (#204, #228). **`send-form.ts`**, beside it so it's not on the first load, sends a
  multipart form (a message's files, a Thing's photo) the same way. **`patience.ts`**, also off the first load, sends
  what's harmless to send twice (an approval's answer) and keeps it, tried every few seconds, even once the worker
  counts as unreachable, until it answers (#204). **`worker-watch.ts`** checks the worker's health while a page needs
  it, waiting for a slow worker the same way, so the "can't reach" banner means unreachable, not busy.
- **Feature folders**, each one feature's parts:
  - **`sessions/`:** the session page: following the event stream and replaying it into turns (`events.ts`),
    revealing text at an even pace (`reveal.ts`), formatting answers (`answer.tsx`, `blocks.ts`; tables and fenced
    blocks Courtyard draws come from `rich-blocks/`), code blocks with
    their language and Copy (`code-block.tsx`), coloured by lowlight (`highlight.tsx`, loaded with the first code
    block, each language's grammar from `code-languages.ts` only when used), formulas drawn by KaTeX (`maths.ts`
    finds and rewrites them, `maths-plugins.ts` is loaded only when an answer has maths), the turn list
    (`session-turns.tsx`, which follows the end only while the owner is at it, never moving them while they read
    back, and offers Jump to latest, #168), the
    message box with its model, effort and skill pickers and its attachments (`attaching.ts` shrinks photos to JPEG
    and checks each file; `messages.ts` sends a message with its files, beside `worker.ts` so it's not on the first
    load), save notes, the usage-limit notice with Carry on, the Get to know offer, Grill this plan beside each
    plan (`grill-plan.tsx`), an answer's Sources (`sources.tsx`), Save as document with each document's note
    (`documents.tsx`), and each Thing save's note (`things.tsx`).
  - **`rich-blocks/`:** the blocks Courtyard draws in answers and documents
    ([ADR 0021](adr/0021-rich-answers-are-blocks-courtyard-draws-itself.md)), through the answer renderer, so a
    document's page gets them too. Every table sorts by its columns (`table.tsx`, with `sorting.ts` saying how dates,
    prices and text sort), keeping its sort as rows stream in. **The seam for fenced blocks** is `fenced.tsx`: in
    `answer.tsx`, a fence whose language is a kind in its `FENCED_KINDS` (a `chart`, a `mermaid`) becomes a
    `FencedBlock`, which loads that kind's drawing (a module whose default export takes `DrawingProps`: the source,
    whether it's still `arriving`, and the `fallback`) the first time one is needed, never on the first load. The
    fallback is the code block with its problem line, "Couldn't draw this <noun>, so here's what the model wrote", or
    just the source while the block is still arriving; a drawing that throws shows it too. A `chart` block
    (`chart.tsx`) is the JSON the contract's `Chart` schema accepts, drawn by our own SVG as bars, lines or a pie in
    the theme's violet and chart colours by name, its values written on it, and scrolling sideways when crowded; `chart-scale.ts` works
    out its value axis. A `mermaid` block (`mermaid.tsx`) is drawn as a diagram by Mermaid once it has all arrived,
    one at a time, in the colours read from the theme, at its
    own size so a wide one scrolls sideways. Mermaid runs strict, with every one of its settings locked so a diagram's `%%{init}%%` or front matter
    changes nothing, laid out by dagre; `diagram-svg.ts` then takes out of its drawing anything that could still run
    script, load something or go somewhere (links keep their words) before it goes in the page, the one place
    Courtyard puts in markup it didn't write itself. Mermaid itself can still load a picture while drawing (a step
    with an `img`, an actor's icon), so the page's own policy (`index.html`) loads pictures only from Courtyard and
    such a diagram shows as written. The build takes Mermaid from its prebuilt files without its ELK layout
    (`mermaidAsDrawn` in `vite.config.ts`), so it adds nothing to the first load. The folder's classes are
    in its own Tailwind stylesheet (`rich-blocks.css`, which `styles.css` leaves the folder out of), added to the page
    by `stylesheet.ts` (through `lib/stylesheet.ts`) from inside the answer renderer's script, so neither the classes
    nor a stylesheet's name are on the first load. They apply only inside a `RichBlock` (`rich-block.tsx`), which
    each table and drawing is wrapped in, never a fallback: coming after the theme's stylesheet, they would otherwise
    outrank its screen-size variants on every page.
  - **`changes/`:** the Recent changes list, with Undo, its calls (`api.ts`), and the note a page shows for
    something just deleted from its own page, with Undo (`just-deleted.tsx`).
  - **`documents/`:** a workspace's Documents section (`documents-section.tsx`) and the documents' calls (`api.ts`);
    a document's page is in `routes/`, drawn with the answer renderer.
  - **`things/`:** a workspace's Things section (`things-section.tsx`, filtered by status), a Thing's card
    (`thing-card.tsx`, its route in `routes/`, its history drawn with the answer renderer), the rows both list them
    in, parts under their Thing (`thing-rows.tsx`), Add Thing's and Edit's form (`thing-form.tsx`), Things' calls
    (`api.ts`) and how their fields read (`words.ts`). Like `rich-blocks/`, its classes are in a stylesheet of its
    own (`things.css`, which `styles.css` leaves the folder out of), added by `stylesheet.ts` when one of its pages
    first loads, and applying only inside a `ThingsScope` (`scope.tsx`), for the same reason.
  - **`tidy/`:** asking for a tidy, and the review with its tick boxes.
  - **`planning-home/`:** a planning workspace's page under its name (#300; Paper, "Tablet · Planning workspace
    Home" and its Sessions, Things and Docs tabs), loaded only for one, with a stylesheet of its own
    (`planning-home.css`, holding the tabs' and Home's blocks' classes too), like `code-home/`. Its tabs, Home ·
    Sessions · Things · Docs, each but Home shown once it has something, with its count, by the address's hash
    (`#sessions`, `#things`, `#docs`; a document or Thing deleted from its page comes back to its tab, with Undo).
    Home: Next up (`next-up.tsx`: the session to pick up again, one the worker says waits on the owner, else the last
    used in the past week, then the worker's `duePlans`; hidden with neither), then the one row for What Courtyard
    knows (`knows.tsx`, `#knows`: the facts, plans and ideas, each line with Fix, which shows then starts a session on
    it, each plan with Grill this plan; Get to know while there are no lines; what else models read, Recent changes,
    Tidy, and the skills), then the message box pinned at the foot. An empty workspace shows only its name, one line
    and the box. Drawn blocks (#257, #152, #294) and the page choices that pin and hide them come with their own
    issues.
  - **`code-home/`:** a code workspace's page under its name (#301, #308; Paper, "Code workspace Home"), loaded
    only for one, with its calls (`api.ts`) and a stylesheet of its own (`code-home.css`, holding the classes of the
    shared pieces only the two Homes show: `components/workspace-tabs.tsx`, `home-block.tsx`,
    `connections-line.tsx`, `radio-row.tsx` and the thumb buttons), like `review/`. Its one line and its connections line, which opens the Connections sheet
    (`connections.tsx`: GitHub, and the Paper file to pick, the one named after the workspace picked already, or
    make; opened by itself as `#connections` right after New workspace → Code). Then its tabs, Home · Sessions ·
    PRs, each but Home shown once it has something, by the address's hash (`#sessions`, `#prs`; the Sessions tab is
    `sessions/session-links.tsx`, the PRs tab `review/`'s list). Home's blocks, in a fixed order, each hidden when
    empty (`components/home-block.tsx`, shared with a planning workspace's Home): Needs you (`needs-you.tsx`: approvals with Approve, failing checks, new replies, pull
    requests ready to merge with Merge, conflicts with Bring up to date, and the setup check's offer), Running
    (`running.tsx`), Next up with Build (`next-up.tsx`), Main (`main-row.tsx`: the repository's newest main
    commit with `live/`'s build bar, and Update only on the live copy's own repository), then the message
    box, pinned at the foot. Nothing jumps in late: each block that loads after the page keeps its last answer
    for the tab's lifetime (`components/kept.tsx`), so a revisit shows it at once and asks again quietly, and a
    first visit shows faint placeholder rows in its place; the PRs list does the same. What waits on the owner is
    the worker's say (`waiting/`, on each listed session and open pull request), read in one place, `needs.ts`,
    with no React or styles, so the home page's tiles read it the same way; nothing in the web app works it out.
  - **`review/`:** a code workspace's pull requests and their page (#160, #240, #278). The list
    (`pull-requests.tsx`, the PRs tab's list, which shares its open pull requests with Home's Needs you): every open
    PR on the repository from `pull-requests/`, whoever opened it, with its title, branch, who it's from and where
    it stands (`checks.tsx`: moss passed, violet running, red failed, gold conflicting with its base), and Review,
    or Bring up to date when it conflicts; or its sessions' merged ones. The PR page (`review.tsx`): a session's PR
    on the session's page in place of the conversation (`?view=review`), and one no session opened on its
    workspace's page, named by the address's hash (`#pr-306`; a search value would add to the first load). From a
    tablet up it fits one screen: All PRs, its title and where it stands, What changed (`what-changed.tsx`, its
    Summary's first line, and Read it all for the whole description, `description.ts`, in a panel that scrolls),
    the changed files as a tree (`components/file-tree.tsx`) beside the chosen file's diff (`diff.tsx`), each
    scrolling inside, the diff's lines never wrapping there (on a phone they wrap and the page scrolls as one).
    Then the latest answer to what was asked from the page, the ask line (`components/ask-line.tsx`: quick asks for
    where it stands and one line, sent to the PR's session on the model it last used, or, with no session, starting
    one on its branch once the owner has seen what starts), and Merge, or Bring up to date when it conflicts, and
    Close PR (`components/thumb-button.tsx`, shared with the approval card): beside the title on a desktop, in thumb
    reach on a tablet, where the answer takes What changed's place. Merged or closed, it folds to one card with
    what's next: Update Courtyard (when the worker is a live copy main has moved on from, offered once main's
    build has passed, by `live/`'s rule), Start a new session and
    Show the changes. Its own lazy load, the list's with a code workspace's page, with its calls (`api.ts`) and a
    stylesheet of its own (`review.css`, holding the ask line's classes too), like `things/`.
  - **`live/`:** updating the live copy from the app (ADR 0011): the notice where Update lives, at the foot
    of the home page (main's build as a row labelled New version, #102) and in the Handheld frame's Settings
    (`live-update.tsx`), and main's build beside Update
    (`main-build.tsx`, #249): the newest main's title, one bar per CI job (violet running, moss passed,
    red failed), and Update, offered only once it has passed; quiet while it runs; Details, the failed
    job's page on GitHub, once it has failed. Its hook asks again every 15 seconds while the build runs
    and the page is in front of the owner, and its rule is the one the merged PR card's Update Courtyard
    follows too. Its own lazy load, with its calls (`api.ts`), so the live status's schemas stay off the
    first load.
  - **`sign-ins/`:** Settings' sign-in box and Connections (each provider, and GitHub with its device code,
    account and repos, Switch and Sign out), and a code workspace's notice that GitHub isn't connected; one lazy
    load wherever they show.
  - **`fresh-start/`:** what a fresh start would clear, and starting one (its page is in `routes/`).
  - **`matt-setup/`:** the setup check's offer (#181), opened from its row in a code workspace's Needs you (#301):
    an approval card (`components/approval-card.tsx`, which a session's approvals use too) saying what's missing,
    then where its pull request is, with its calls (`api.ts`).
  - **`notifications/`:** Settings' notifications toggle for this device, beside Connections (#173): it
    subscribes the browser with the worker's key and sends the subscription, sends it again each time the page
    opens (so it follows the device's login), and unsubscribes on off; its own lazy load.
  - **`new-workspace/`:** New workspace's form (#258, #264), loaded with its page, with its calls
    (`api.ts`) and a stylesheet of its own (`new-workspace.css`, holding the repo picker's classes too,
    `components/repo-picker.tsx`), like `review/`. A switch picks Planning (the form as it was) or Code,
    which lists the owner's repos to pick one from; picking one fills in the name (title-cased from the
    repo's) and What's it for? (its description on GitHub), shown in full (`WrappingTextField`) before
    Create. Name is focused on a desktop only, so a touch screen's keyboard waits for a tap. The page
    offers What's it for? to the frame's talk strip and Talk key (`handheld.ts`'s `offerField`), which
    put what's said there as they would in a message box. A code workspace just made opens with its
    Connections sheet (`#connections`), offering Paper, which Close skips (#308).
  - **`home/`:** what the home page loads after it shows (#102; Paper, "Home"; from a tablet up the page is one
    screen, its title and foot rows in view and only the tiles scrolling, until #339 makes that the app's), with a stylesheet of its own
    (`home.css`, holding `components/kept.tsx`'s classes too), like `code-home/`. Each tile's line
    (`tile-line.tsx`): what waits on the owner, as the worker says and Needs you reads it (`code-home/needs.ts`),
    from the workspace's sessions and, on a code workspace, its open pull requests (`review/open-pull-requests.ts`, the store its Home
    and PRs list share), else when it was last used; kept for the tab's lifetime, a faint line in its place until
    then, so nothing jumps. And the foot rows (`foot.tsx`), shown only when needed: main's build with Update
    (`live/`), and one gold problem line, the worst of what's wrong (context changes not kept, the backup
    behind, a workspace's config ignored, no backup set up), with Fix it to where it's fixed.
- **Settings and login pieces** sit at the top of `src/`: the backup notice (`backup-status.tsx`), the owner context panel (`owner-context-panel.tsx`), the setup and login form
  (`password-page.tsx`), logging out other devices (`log-out-others.tsx`), what to show when the worker gives no data
  (`problems.tsx`), and how dates read (`when.ts`). Beside them, `workspace-page.ts` asks for everything a
  workspace's page shows; its route's loader imports it, so that code and its schemas aren't on the first load.
- **`components/`:** Courtyard's shared pieces (buttons, copy buttons, web links, text fields, file pickers, sheets, notices, Connections' cards and so on), used
  on every page ([ADR 0012](adr/0012-courtyards-own-building-blocks-safe-on-the-first-load.md)). One, a table
  heading's sort button (`sort-button.tsx`), only a rich block uses, so its classes are in `rich-blocks.css` with
  the folder's, and it's styled only inside a `RichBlock`. The pieces that keep a session's flow (#179, #177,
  #168) have a stylesheet of their own too (`chat-flow.css`), added when one first shows and applying only inside a
  `ChatFlowScope`: whose turn it is in a session (`session-state.tsx`, in the chat, a workspace's sessions and the
  sidebar's recent ones, which ask again every few seconds while one is working), the Working line and the Your turn
  mark (`working-line.tsx`), queued messages (`queued-message.tsx`) and Jump to latest (`jump-to-latest.tsx`).
  The frame round every page is picked by `handheld.ts` (#193): a desktop keeps the sidebar (`app-sidebar.tsx`) and,
  in a narrow window, the strip (`workspace-strip.tsx`); a touch screen gets the Handheld frame
  (`handheld-frame.tsx`), loaded only there with its own stylesheet (`handheld-frame.css`). On a tablet or the
  unfolded Fold (#206): workspace tiles down the left, and down the right labelled buttons (Model, Skills, Add,
  Settings) with the Talk key in the bottom corner; on the folded one, tiles across the top and a bottom bar with
  Type and the talk strip. The page's message box (`sessions/composer.tsx`) offers itself to the frame through
  `handheld.ts`'s dock and moves into it: always there between the rails on a tablet, above the bar once opened on
  the folded Fold. It opens its pickers from the frame's Skills, Photo (Add) and Model buttons. The talk strip and
  the Talk key (`talk-strip.tsx`, #79, #206, loaded with the frame) share one way of talking: they listen through the
  browser's own speech recognition (`speech.ts`, which also vibrates for it) and put the words in the box as they are
  heard (#198), for the owner to send, or to queue while a turn runs; on a page without a message box,
into the field the page offers instead (`offerField`, New workspace's What's it for?, #264). For the Talk key, the box shows ✕, ■ and ↑
  under the words while it listens (`listening-row.tsx`, loaded once it's docked). While the owner talks or an answer
  comes, the screen is kept awake (`wake-lock.ts`) where the browser can;
  nothing said reaches the worker except the words. The page stays mounted in the same place whichever frame is
  round it, so folding keeps its scroll and a half-written message. The frame's menus and the box's pickers open as Handheld sheets (`handheld-sheet.tsx`, #194): from the right edge
  beside the right rail on a tablet, from the bottom on a phone. The box's Skills and Model sheets
  (`sessions/handheld-choices.tsx`, built from `sheet-choices.tsx`) load only once it's docked; their classes, and
  the listening row's, are in `handheld-frame.css`. A desktop keeps the box's own pickers, and a narrow desktop window its bottom sheets
  (`sheet.tsx`). A workspace's icon (#210, `workspace-icon.tsx`) shows on its tile, in the sidebar, the strip, the
  home page's tiles and the way back, white or violet while it's open; the icons themselves (`workspace-marks.tsx`,
  lucide's) load once a page first shows one, off the first load. The workspace page's icon opens the Icon sheet
  (`icon-sheet.tsx`, through `icon-chooser.tsx`, loaded when first opened): a Handheld sheet on a touch screen, a
  bottom sheet on a desktop. Arrange workspaces (#321): holding a workspace on a tablet's rail or in the sidebar and
  dragging it up or down within its group saves the order on the worker, and every list of workspaces follows it
  (the strip, the cover screen's tiles and Home's, which can't be dragged themselves). Only the press is on the
  first load (`arrange.ts`, with Alt+↑ and Alt+↓ for the keyboard); the drag and the save load with the first one
  (`arranging.ts`). The held one stays in its list as the dashed slot, so a finger keeps its touch on it.
  **`lib/`:** small
  helpers shared by pages. **`styles.css`:** the theme: Handheld, dark whatever the device's setting (#210).
- Beside `src/`: **`public/`** has the service worker (which also shows a pushed notification, unless that
  session is open in front of the owner, and opens the session on a tap, asking the worker which workspace it's in)
  and the install manifest, and **`scripts/finish-build.mjs`**
  runs after each build to stamp the service worker with the files it keeps on install (all but Mermaid's, which it
  keeps once a diagram needs them) and check the first-load budget. `vite.config.ts` keeps everything
  the first load needs in one file, so a lazily loaded module that lazy code loads (a chart) can't split what it
  shares with the first load, such as React and Zod, into files of their own.

### The house skills: `packages/skills`

`@courtyard/skills` holds Courtyard's own skills, a folder each in the Agent Skills format, and `skills.json`: the
kinds of workspace that get each one, whether only the owner starts it (ADR 0016), and its mark in the app (`icon`:
flame, person or the default book; a skill of the owner's gives one as `icon` in its SKILL.md's `metadata`). It also
holds the format check (`checkSkill`, the reference validator's rules in TypeScript), which its own test runs on the
house skills in `pnpm verify` and the worker runs on everyone's. It's a package of its own so it can move to a repo of its own (#88).
`matt.json` pins the release of Matt Pocock's skills code workspaces get (ADR 0024): its version, the checksum of the
copy the worker keeps, the ones the Skill picker lists, and the marks some of them show (`icons`).

### The machine's builds lock: `packages/builds`

`@courtyard/builds` is the one lock every heavy check on the machine takes (#306), so Courtyard's code sessions and
the builds run beside them (a helper's `pnpm verify` in another checkout) take turns rather than lock the machine up
together. It's a folder, `<OS temp>/courtyard-builds` (`COURTYARD_BUILDS_LOCK_DIR` moves it, which only the tests
and the browser tests' workers do), with a file for each place taken, up to `COURTYARD_BUILDS_AT_ONCE`: each made
only if it isn't there yet, naming its holder (a session, or `helper <folder>`), its process and when it took it. A
place whose process has gone is cleared by the next one waiting, so a crash, or a worker restarting, never blocks
for ever; a run that cleared one checks the place it took is still its own once the dust settles, in case two cleared
it at once. The worker's builds queue takes it (`code/builds.ts`) and so does `scripts/builds/run.ts`, which the
root `verify`, `test`, `e2e` and `build` scripts run through: it waits for a place, saying who holds it and since
when, runs the command with `COURTYARD_BUILD_HELD=1` (a run that sees it goes straight through, so `verify` doesn't
wait on itself when it runs `e2e`), and frees the place however the command ends. It's a package of its own, rather
than the worker's, because the repo's scripts need it with no worker running, and nothing else of the worker's.

### The contract: `packages/contract`

Every shape that crosses between the web app and the worker, as Zod schemas with their types inferred, one file per
topic in `lib/`: login, workspaces, sessions and their events (`session.ts` for what the home page needs,
`session-event.ts` for the events, which only the session page parses, and `session-state.ts` for whose turn it
is in each session a list shows and what it waits on the owner for, with what the session page has shown the
owner, which only the pages listing sessions parse), attachments (an event's in `attachment.ts`,
a photo or a PDF by its media type, the limits and checks in `attachment-file.ts`), skills, saves and changes,
tidies, usage limits and overflow, sign-ins, the owner's GitHub repos New workspace offers (`github-repos.ts`,
which only that page parses), backup, live updates with main's build, fresh start, health and errors, and a `chart`
block's JSON (`chart.ts`, which a model writes and the web app and the eval check). One piece is no shape:
`command-words.ts` reads a shell command's words as a POSIX shell does, which the worker matches against the
allowlist and the web app summarises a command's activity line from (#285). The worker's
answers are checked against these types;
the web app parses every answer with these schemas.

### Outside the apps

- **`e2e/`:** the browser tests. `start-worker.mjs` starts a real worker on fresh folders with the fake providers,
  the fake GitHub (with two pull requests no session opened, #278, and for a second code workspace, Workbench,
  ready issues in milestones and a helper's pull request, #301), the owner's Paper files in memory (#308), a
  stand-in for Matt Pocock's plugin and a stand-in `gh` that never reaches GitHub;
  `fixtures/context/` is the context folder they start from.
- **`scripts/live/`:** the live copy's scripts, for Windows: start the worker at log on, and update it (ADR 0011).
  The update builds with `pnpm -r build`, never waiting on the machine's builds lock, since Courtyard is down until
  it's done.
- **`scripts/builds/`:** the machine's builds lock for the repo's own heavy scripts (see `packages/builds`).
- **`.github/workflows/ci.yml`:** what `pnpm verify` runs, on every pull request and every push to `main`, split into
  jobs side by side (Checks, Unit tests, E2E in four shards) so a run takes about 3 minutes; `.github/actions/setup`
  is the setup they share.
- **`.github/workflows/roadmap.yml`:** files an issue that comes in without a milestone into `Later` (with
  `needs-triage` when it has no triage label), on filing and once a day, so the milestones stay the whole roadmap.
- **`.github/workflows/matt-skills.yml`:** once a week, runs `scripts/matt-skills/check.ts`, which compares
  `matt.json` with Matt's newest release and, when it's behind, writes an issue with his CHANGELOG lines and the new
  pin (its checksum worked out as the worker checks it); the workflow opens it, once per release (ADR 0024).

## How a turn flows

When the owner presses Send, the worker writes the message down and answers at once. The turn then runs on the
worker to the end, whether or not anyone is watching. Everything the model does is written to the session's event log
first, and only then sent to the browsers following it. The browser draws the session from those events alone, so a
page that reconnects, or opens later, asks for everything after the last event it saw and catches up
([ADR 0006](adr/0006-sessions-are-event-logs-in-plain-files.md)).

```mermaid
sequenceDiagram
  participant B as Browser (sessions/)
  participant S as Worker: sessions/
  participant L as Event log (events.jsonl)
  participant F as Worker: prompts/
  participant P as Provider seam
  participant M as Model

  B->>S: POST /api/sessions/:id/messages
  S->>L: owner-message
  S-->>B: 202, at once
  B->>S: GET /api/sessions/:id/events?after=N
  Note over B,S: server-sent events, kept open
  S->>F: owner context, context file or connections, conversation so far
  F-->>S: the turn's framing, with the save tool
  S->>P: run the turn
  P->>M: Agent SDK, Codex app-server or the fake
  M-->>P: text, activity, saves
  P->>S: each piece as it comes
  S->>L: text-delta, activity, context-saved, sources
  L-->>B: each event once it's written, numbered
  S->>L: turn-completed, turn-stopped or turn-failed
  Note over B: replays events into turns,<br/>reveals text at an even pace
```

Where the rest fits:

- **Saves.** The model calls the save tool its framing offered. `saves/` checks the line and writes it as a change
  through `context-folder/` at once; the session records it and the browser shows a note. A refused save is explained
  to the model, which may put it right once
  ([ADR 0013](adr/0013-models-save-context-as-they-chat-and-the-owner-undoes.md)).
- **Documents.** The model calls the document tool, or the owner taps Save as document under an answer.
  `documents/` checks it and writes it as a change through `context-folder/`; the session records a
  `document-saved` event and the browser shows a note with Open and Undo. Each turn lists the documents; a model reads
  one with the file tools, and that read is what an update is checked against
  ([ADR 0020](adr/0020-documents-and-things-are-files-in-the-context-folder-saved-with-undo.md)).
- **Things.** The model calls the Things tool by the labels its turn listed. `things/` checks the call and writes it
  as a change through `context-folder/`, resizing a photo from the turn's attachments first; the session records a
  `thing-saved` event and the browser shows a note with Open, which goes to the Thing's card
  (`/workspaces/:id/things/:slug`), and Undo. The owner's own adds, edits, deletes and photo uploads, from the
  workspace page's Things section and each card, go through `things/`'s routes, each a change Recent changes can undo
  ([ADR 0020](adr/0020-documents-and-things-are-files-in-the-context-folder-saved-with-undo.md)).
- **Suggested replies.** The model calls the suggest replies tool its framing offered (planning workspaces only).
  `suggested-replies/` checks them; the session records them as an event and the browser shows them as buttons under
  the latest answer, once its turn completes, until the owner replies. A tap sends one as the owner's message
  ([ADR 0017](adr/0017-models-offer-suggested-replies-through-a-courtyard-tool.md)).
- **Web search.** In a planning workspace, a model searches the web with its provider's own search and reads pages
  (ADR 0019): Claude through Claude Code's `WebSearch` and `WebFetch`, the adapter's hook allowing a fetch only for a
  page in the turn's search results or a link the owner sent; Codex on cached search, set for its thread. Each search
  and page read is an activity. Once the answer is written, the provider hands the worker the turn's sources
  (`sources/`), which the session records as one `sources` event and the browser lists under the answer.
- **Code sessions.** Only a provider that codes works in a code workspace; any other is refused, saying so. A new
  session there starts its session branch and worktree (`code/`) before its first turn, and keeps the branch in its
  `session.json`. Each turn runs in the worktree, with a `CodeTurn` the provider asks before every edit and command:
  Claude's hook asks it for each `Edit`, `Write` and `Bash`, and the fake for each scripted line. Claude Code's
  background tasks are off, and the hook refuses a `Bash` call asking for the background without asking (#178): a
  turn's commands end with it. What's allowed shows
  as an activity (`edited-file`, `ran-command`). A command off the allowlist, an edit outside the worktree, or one to a
  file that decides what allowed commands run (an approval of its own kind, `setup`), is an
  approval (#171): the session records an `approval-requested` event and the `CodeTurn` call waits on it, with no time
  limit (Claude's hook too). Allow or Deny, from any device, goes through `sessions/` and is recorded as
  `approval-answered`, so the browser's card goes everywhere; the first answer stands. A stop ends the wait, and a
  denial tells the model why. With six code sessions' turns running, a seventh records `turn-queued` and waits, `turn-dequeued`
  once it starts; the workspace's sessions list marks it `queued`, with how many are running, and deleting it
  before it starts clears its branch and worktree away.
- **The builds queue** (#281). A heavy check the `CodeTurn` allows (or the owner does) waits inside the provider's
  call for its place in `code/`'s builds queue before it's recorded as `ran-command`, recording a
  `waiting-for-build` activity with how many builds are ahead each time that changes (the browser keeps one line
  for it, the latest). A stop ends the wait and leaves the queue. The provider says when each command it ran has
  ended, however it ended (`CodeTurn.ran`: Claude's `PostToolUse` and `PostToolUseFailure` hooks, the fake after
  each scripted command), freeing its place; whatever a turn still holds is freed when the turn ends, completed,
  stopped or failed. The queue is between sessions; the machine's builds lock (#306) is between everything that
  builds on the machine. The build at the queue's front waits for a place in the lock before it starts, still
  `waiting-for-build` (with how many places others hold) while a build outside Courtyard, such as a helper's
  `pnpm verify`, holds them all. A session's commands get `COURTYARD_BUILD_HELD=1`, since each of its builds runs only
  once it holds a place, so the repo's own scripts it runs go straight through rather than wait on that place.
- **Tool connections.** A code workspace that names Paper hands each turn on a provider that uses tools a
  `ToolConnection` from `paper/` (ADR 0023). Claude's adapter passes its MCP server to Claude Code (a command it
  starts, `paper mcp`), its hook asks the connection about each of the server's tools, and its `PostToolUse` and
  `PostToolUseFailure` hooks hand each result back, adding what the worker says to a failure. A delete that asks is
  an approval of its own kind (`tool`), on the same card. Each screenshot is kept in the session's folder beside its
  attachments and recorded as an `image-shown` event, which the browser shows under the answer as a thumbnail, the
  newest of each board, from the attachment route. Every code turn, Paper or not, is told its workspace's
  connections in one line from `connections/`, in place of a context file (#308, ADR 0026): what it has, and what's
  missing and where the owner adds it.
- **Attachments.** A message with photos or PDFs goes as a multipart form: the message's JSON in one field, the
  files in another (with a Thing's photo, the only requests that aren't JSON, and the only ones allowed past the
  small body limit).
  `attachments/` checks them and keeps them in the session's folder; the owner message's event records each one, and
  the browser shows them from the attachment route. Each turn carries the session's last ten: `prompts/` puts each
  PDF's text in the message and lists the photos, which each provider sends its own way (below). They go with their
  session when it's deleted (docs/ai-conduct.md, Attachments).
- **Undo and Edit.** From a save's note, through `sessions/` to `saves/`; or from Recent changes, through `changes/`.
  Each is a change of its own, and the session records what the owner did to its save.
- **Stop.** The worker tells the provider to stop, stops waiting for it at once, and drops anything it sends
  after. What was written so far stays, and the turn is recorded as stopped.
- **Queued messages** (#177). A message sent while a turn runs (waiting for a code session's slot or an approval
  included) is recorded as `message-queued`, its attachments kept already, and every device shows it under the
  turn. Once the turn ends, however it ended, the first still queued goes as its own turn, its `owner-message`
  naming it (`queued`), checked in the session's queue so one removed meanwhile (`queued-message-removed`) never
  goes; after a usage limit they wait for the owner's next turn (Carry on, say). A queued message going first means
  no fixing turn for failed checks starts then (#172), and no "Turn finished" notification goes. One a stopped
  worker left waiting goes once the next worker starts (`resumeQueued`).
- **Whose turn it is** (#179). The session page works it out from the events: Working (since the owner's message,
  on the latest activity or the answer), an approval waiting, or the turn's end, marked Your turn. A workspace's
  list of sessions has the worker's say for each (`now`: working, needs-you or your-turn), which the workspace page
  and the sidebar ask for again every few seconds while one is working or needs the owner. Your turn isn't a new
  reply: whether one waits on the owner is `waiting` on the same list (`waiting/`, #334), cleared once the session
  page has shown the owner its answer, on any device.
- **Usage limits.** A provider fails the turn as rate-limited, with its reset time when it knows it. `limits/`
  remembers that until the reset, and the model pickers show it. Nothing switches model by itself, but whatever has
  no model named avoids one at its limit: a new session, Get to know, Tidy and a session's title each go to the first
  model with room (for Get to know and Tidy, the first that saves to context). The worker picks it, not the browser.
  A session whose provider shows as unavailable keeps its model in the picker, and Send waits until the provider is
  back or the owner picks another (#299).
- **Carry on.** On the last turn, when it failed on a usage limit, the owner can carry on. The session records the
  model change and sends the last message again to another provider's model, with the conversation so far (spec,
  Overflow).
- **Titles.** After the first turn completes, a model gives the session a short title, unless the owner renamed it
  first or Get to know named it.
- **A worker that stopped mid-turn.** The first time the new worker touches a session, a turn its log still shows as
  running is recorded as interrupted, so the session can carry on, and its next queued message, if any, goes.
- **Notifications.** Once an `approval-requested`, `turn-completed` or `turn-failed` is recorded, `sessions/` tells
  `notifications/`, which pushes one to each device logged in that turned them on (a stopped turn, and an
  interrupted one found by the next worker, send none). A code turn's end waits for its PR to be followed, so one
  ending with the PR's checks still failing says "Checks still failing: e2e", not "Turn finished" (story 31). The
  service worker shows it and opens the session on a tap.

## Where things live

Everything Courtyard keeps is in two folders outside this repo, named by the worker's settings. The **context folder**
is what models know, and the owner can edit it by hand. The **data folder** is Courtyard's own working state. A few
things live only in the worker's memory and go when it restarts.

**The context folder** (`COURTYARD_CONTEXT_DIR`) is a git repository
([ADR 0009](adr/0009-the-context-folder-is-a-git-repo-with-its-main-copy-on-a-remote.md)):

- `OWNER.md`: the owner context ([ADR 0010](adr/0010-every-workspace-also-gets-the-owner-context.md)).
- `workspace-order.json`: the owner's order for the workspaces (#321), one list of ids for every device; planning
  ones and code ones each keep their own group.
- `<workspace>/CONTEXT.md`: a planning workspace's context file; a code workspace has none (ADR 0026).
  `<workspace>/workspace.json`: its name, mode and icon (and a code workspace's repo, its one line as
  `description`, allowlist changes and Paper connection, with the file's name once connected from its page).
- `<workspace>/docs/<slug>.md`: a planning workspace's documents (ADR 0020), each named by its first `#` heading and
  its file by that name.
- `<workspace>/things/<slug>.md`: a planning workspace's Things (ADR 0020), fields in front matter and a dated
  history, each file named by the Thing's name when it was added; `<workspace>/things/photos/<slug>.jpg`: a Thing's
  photo, resized to fit 1600 px and 300 KB, in plain git.
- `.agents/skills/<skill>/` at the top: the owner's skills for every workspace; `<workspace>/.agents/skills/<skill>/`:
  their skills for one workspace (ADR 0016). Added by hand, so they're kept and backed up like everything else.
- `archived/<workspace>/`: archived workspaces.
- Every change is kept as a commit; hand edits are committed before the next change and every ten minutes. After each
  change the folder is pushed to its backup, `COURTYARD_CONTEXT_REMOTE`: any git remote the owner chooses, such as a
  shared folder on a NAS ([ADR 0014](adr/0014-the-context-backup-is-a-shared-folder-on-the-nas.md)).

**The data folder** (`COURTYARD_DATA_DIR`):

- `sessions/<session>/`: `session.json` (title and times, and a code session's branch, with `keepsBranch` when the
  branch was in the repository before it, #326), `events.jsonl` (the event
  log), `seen.json` (the last event the owner has seen, on any device, #334) and `attachments/`: each photo or PDF the owner attached, by its id, and each PDF's text beside it.
- `matt-skills/<version>/`: Courtyard's copy of Matt Pocock's plugin at the pinned release (ADR 0024): his
  `plugin.json`, licence and skills, checked against `matt.json`'s checksum. `matt-setup.json`: each code workspace's
  answer to the setup check (#181).
- `worktrees/<session>/`: a code session's worktree, its session branch checked out from the workspace's repository
  (ADR 0007). It belongs to that repository's worktree list, so it stays when the session is deleted or set aside by
  a fresh start; it and its branch are cleared away once the session's pull request is merged or closed (#172).
- `repos/<owner>/<name>/`: a GitHub repo New workspace → Code got onto the worker machine for a code
  workspace (#258), a plain clone whose `origin` is the repo on GitHub; the workspace's `repoPath`
  names it. It stays when the workspace is archived, and is used again if the repo is picked again.
- `fresh-starts/<date>/`: sessions set aside by a fresh start.
- `owner.json`, `device-logins.json`, `failed-logins.json`: the owner's password, each device's login (only the hash
  of its secret), and recent wrong guesses.
- `github/`: Courtyard's GitHub sign-in (`sign-in.json`) and the `gh` config folder code sessions use (`gh/`),
  holding the token while signed in and a stand-in that works nowhere otherwise (#99).
- `notifications/`: the worker's push keys (`keys.json`) and each device's push subscription, by its device login
  (`devices.json`) (#173).
- `codex/`: the Codex home, holding Codex's sign-in
  ([ADR 0015](adr/0015-codex-runs-through-its-app-server-in-its-own-codex-home-without-a-shell.md)).
  `sign-ins.json`: the providers the owner said Not now to.
- `live-update.json`, `live-update.log`, `worker.log`: the live copy's last update and the worker's output.

**Only in the worker's memory:** usage limits, tidies waiting for review, and which turns are running.

**The other settings** set the worker's port (`COURTYARD_PORT`), point at the web app's built files
(`COURTYARD_WEB_DIR`), name the live copy and its update task (`COURTYARD_LIVE_COPY`, `COURTYARD_UPDATE_TASK`, set by
`scripts/live/`), or switch providers on and off. `apps/worker/src/settings.ts` lists them all;
[`.env.example`](../.env.example) explains the ones an owner sets.

**A fresh start** clears the context folder as one change, so its history and the backup still have every file. It
moves every session to `fresh-starts/<date>/` and drops any tidy waiting for review. It keeps the owner's password and
device logins, the sign-ins (the Codex home, Not now and GitHub's) and the usage limits. The README says how to bring things
back.

## The rules that hold it together

Each one is written down once, where the link goes.

- **The worker owns everything:** the web app is static files that show things and ask the worker
  ([ADR 0001](adr/0001-the-worker-owns-everything-the-web-app-is-static-files.md)).
- **One contract:** every shape crossing between web app and worker is a Zod schema in `packages/contract`
  (AGENTS.md, Where code goes).
- **One provider seam:** Claude, Codex and the fakes all sit behind `providers/index.ts`, and only an adapter knows
  how its provider is signed in or billed (AGENTS.md;
  [ADR 0003](adr/0003-claude-through-the-agent-sdk-with-the-owners-login-isolated-per-workspace.md)).
- **Errors are values:** module interfaces return `Result` (`result.ts`); throwing is for bugs (AGENTS.md,
  TypeScript).
- **Dependencies passed in:** the clock, the providers, GitHub, the notification sender, the update command, fetching
  Matt's skills, the repeating jobs and the work nobody waits for (titling a session, notifying the owner) are options
  to `createWorker`, so tests control them (AGENTS.md, Where code goes). Tests wait for that work before removing their
  folders (`removeTestFolder` in `testing.ts`).
- **Three places tests go:** the worker's API in-process and the provider seam (`apps/worker/src/*.test.ts`), and
  the browser (`e2e/`) (AGENTS.md, Tests; spec, Testing Decisions).
- **The first-load budget:** the build fails if what the home page needs first grows past its budget
  (`apps/web/scripts/finish-build.mjs`; [ADR 0012](adr/0012-courtyards-own-building-blocks-safe-on-the-first-load.md)).

## The AI setup

Two kinds of model work with this repo, and each has its own files. **Models building Courtyard** (coding agents
working on the repo) read the files in the first list; every repo has these. **Models inside Courtyard** (the ones
the owner talks to in a session) read what the second list builds; only an app that runs models has these.

### Building it with models

- **[`AGENTS.md`](../AGENTS.md):** start here: where code goes, TypeScript, tests, safety and process. `CLAUDE.md` only
  points to it, so every model reads the same file.
- **[`GLOSSARY.md`](../GLOSSARY.md):** the words to use, and the words to avoid.
- **Spec issues on GitHub:** what is being built, written with Matt's `to-spec`; [`docs/spec.md`](spec.md) is the
  original, frozen. **[`docs/adr/`](adr/):** why it is built that way.
- **`docs/architecture.md`:** this map.
- **[`docs/agents/`](agents/):** what Matt's setup writes, kept as he writes it (`issue-tracker.md`,
  `triage-labels.md`, `domain.md`), and Courtyard's one addition, [`roadmap.md`](agents/roadmap.md): the GitHub
  milestones that hold the order of work.
- **Skills:** the process is [mattpocock/skills](https://github.com/mattpocock/skills) as it is, installed on the
  machine of whoever works on the repo from Matt's own plugin list, so it updates itself; AGENTS.md's Agent skills
  section says which docs they read. Skills for building Courtyard would go in `.agents/skills/` at the repo's top
  (none yet); how every repo carries this is #88. Inside Courtyard, every code workspace gets his skills from the
  pinned copy instead (ADR 0024).

### Models inside it

Everything Courtyard's models read is built in one place, from written rules, and every provider gets the same text.

- **[`docs/ai-conduct.md`](ai-conduct.md):** the rules for everything a model is told. Read it before changing any of
  it.
- **`apps/worker/src/prompts/`** builds it: each turn's framing, the replies to Courtyard's tools, Tidy and
  titling. Get to know and Get to know me are house skills in `packages/skills`.
  `context-file/` adds the line labels, and `saves/` checks what the save tool is sent.
- **Each provider passes it on unchanged:**
  - Claude gets it as the system prompt, with Courtyard's tools on one in-process server, and none of the worker
    machine's Claude Code setup, its skills included (ADR 0003). Each turn's message goes as streaming input: one
    message from the owner, its text then each photo as an image. In a planning workspace it also gets `WebSearch`
    and `WebFetch`, confined as ADR 0019 says. In a code session the framing is appended to Claude Code's own system
    prompt (its `claude_code` preset) instead, with no turn limit
    ([ADR 0025](adr/0025-a-code-session-runs-on-the-providers-own-coding-instructions-with-courtyards-appended.md)),
    and it works in the session branch's worktree with `Edit`, `Write`, `Bash`, `TodoWrite` and `Skill` as well, and
    loads the repository's own project settings (its `CLAUDE.md` or
    `AGENTS.md`) and only the repository's own skills, still none of the machine's setup
    ([ADR 0022](adr/0022-code-sessions-follow-the-repositorys-own-claude-code-setup.md)), and Matt Pocock's skills as
    a local plugin from Courtyard's pinned copy, those the workspace can use turned on by name, which its Skill tool
    loads and its file tools read (ADR 0024). With Paper, Paper's MCP server too, started as a command, its tools
    asked of the worker (ADR 0023).
  - Codex gets it as its instructions, with Courtyard's file tools and other tools as the thread's own, in its own
    Codex home with its own skills and `AGENTS.md` switched off (ADR 0015); each thread starts with every skill Codex
    finds itself turned off, and in a planning workspace searches the web on cached mode (ADR 0019).
    [`docs/real-codex-check.md`](real-codex-check.md) checks what's switched off against a real Codex before its
    version changes. Each photo goes with the message as `localImage` input, by its path in the data folder.
  - The fake echoes, and saves, saves a document or a Thing, loads a skill, suggests replies or acts out a web search when a test scripts it, or
    says which attachments it was given ("please look"). In a code session it edits a file ("edit file …") and runs
    a command ("run command: …") when the worker allows, and says why when it doesn't, and updates its task list
    ("update the task list"); Fake two doesn't code. With
    Paper, it plays Paper ("paper <tool> {…}"), so the browser tests never start the real app.
- **`apps/worker/eval/`:** the context eval runs invented conversations against real Claude or Codex and scores
  their saves, documents and Things, the skills they load, the replies they suggest and whether they search the web. It runs on demand,
  never in CI (`pnpm eval:context`; ai-conduct.md, The eval set).
- **Skills for Courtyard's models** (ADR 0016): the house skills in `packages/skills` and the owner's in the context
  folder, found by `apps/worker/src/skills/`, listed on every turn and loaded through the use skill tool, or started
  by the owner, the same on every provider (ai-conduct.md, Skills).

## Where to read more

- The spec issues on GitHub, and [`docs/spec.md`](spec.md), the original spec (frozen): what Courtyard does.
- [`docs/adr/`](adr/): why each big choice was made.
- [`GLOSSARY.md`](../GLOSSARY.md): Courtyard's words.
- [`docs/ai-conduct.md`](ai-conduct.md): what models are told, and how it's checked.
- [README](../README.md): setting it up and running it.
- [`AGENTS.md`](../AGENTS.md): the rules for working on the code.
