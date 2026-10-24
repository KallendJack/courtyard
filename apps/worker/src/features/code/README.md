# code

Code sessions' git, and what they may do
([ADR 0007](../../../../../docs/adr/0007-code-sessions-work-on-a-session-branch-in-its-own-worktree.md)).

**Example:** you tap Build on an issue. The session gets its own branch, `courtyard/1a2b3c4d`, in its own worktree;
`pnpm test` runs without asking, waiting its turn in the builds queue, and `git push --force` asks you first.

- **Uses:** `github/` (Courtyard's sign-in for its commands and fetches), `workspace-files/`; `workspaces/`'
  allowlist changes, through `allowlistFor`.
- **Used by:** `sessions/` (each code turn's `CodeTurn`), `providers/`, `prompts/` (wording each refusal),
  `pull-requests/`, `next-up/`, `lead/` (`changedFiles`), `red-main/`, `repos/`, `matt-setup/`, `connections/`,
  `workspace-main/`, `worker.ts`.

## API

- `GET /api/workspaces/:id/allowed-commands` and `POST …/allowed-commands/remove` (in `worker.ts`): Workspace ⋯ →
  Allowed commands.

## How it works

### The session branch and worktree

- Starts a session's session branch (`courtyard/<start of its id>`) from the default branch on the repository's
  remote (`origin`, standing in for GitHub), freshly fetched, in its own worktree in the data folder, so the owner's
  checkout is never touched; or says why it can't (the repository missing, not git, or its remote unreachable).
- Finds a session branch's pull request on GitHub (the repository named by its remote's address).
- Clears a session's worktree and branch away, and, once its PR is merged or closed, the branch it pushed to GitHub
  (only a `courtyard/…` one).
- `startOnBranch` starts a session on a branch that isn't a `courtyard/…` one, for `pull-requests/`.
- Helpers' worktrees and branches (#395): `branchOff`, `mergeBack` and `clearHelpers`, named by `branches.ts`
  ([How a turn flows](../../../../../docs/architecture.md#how-a-turn-flows), Helpers).

### Edits

- Decides each edit: inside the worktree once symlinks are followed.
- A file that decides what allowed commands run (a `package.json`, git hooks, `.claude` or git's own `.git`) needs an
  approval.

### Commands: `allowlist.ts`, `routine.ts`, `paths.ts`, `allowing-all.ts`, `commands.ts`

`allowlist.ts` holds the rules, `routine.ts` the routine work in the worktree (#730), `paths.ts` how a command's
paths are read, `allowing-all.ts` what Allow all covers, and `commands.ts` (`commandAllowed`, `editPlaceIn`) reads
them against the worktree's files and git.

- **Routine work never asks** (#730, ADR 0038): moving, copying, making and removing the worktree's files (`mv`,
  `cp`, `mkdir`, `rm`, `git mv`, `git rm`, `git restore`, `git checkout <ref> -- <paths>`, `git reset -q`), never the
  whole worktree, what a glob would find, or a file that decides what runs (each rule's `writes`); code given on the
  line (`node -e`, `python -c`) as Allow all reads it, naming no setup file; the repository's other check scripts by
  name (`lint`, `test:e2e`, `format:check`; never one that watches, serves, deploys or publishes); `git rebase
  origin/<branch>`, `git merge --ff-only`; a bare `git push` once git says it goes to the session branch's own name
  on origin; listing branches and worktrees; a trace unpacked with `tar` or `unzip` into a folder git ignores;
  `date`, `echo`, `sleep`, `file`, `cmp`, `cut`, `pnpm view`; gh's search, release and workflow lists; the
  repository's issues named with `--repo` by its own name; and a test run's `PORT`, `CI`, `TZ`, colours or
  `COURTYARD_E2E_SHOTS` in front of a command (`withoutEnv`). A search's pattern is never read as a path, a short
  option's value only after its letters (`-L13,13:path`), a pnpm `-C` folder's paths from that folder, and code's
  `..` paths from the folder of a file it names, so an import it writes isn't one it opens.
- **Matched on words.** The command allowlist is matched on the command's words once its quotes are read (the
  contract's `wordsOf`), never on the start of its text, so a command that chains, pipes, redirects or substitutes
  never matches. One naming a path outside the worktree is refused. Committing, pushing and the session's own PR need
  the worktree on the session branch.
- **The default allowlist:** the shell commands that look around the worktree (`cat`, `ls`, `grep`, `rg` and the
  like; #178); the package scripts (in the packages pnpm's `--filter`, `-C` or `-r` pick too, when the script alone
  would match) and the test tools they run, run directly (`vitest run`, `playwright test`, `tsc --noEmit`,
  `biome check`, `biome format`; #202, #591); git and gh commands that only look (`gh run watch` among them, #591); adding and committing; pushing the session branch (only
  to `origin`, under its own name, never forced); and `gh pr create`/`gh pr edit` on the session's own PR (#172).
  Their flags are read, so one naming another branch, repository or PR, or one it doesn't know, asks.
- **Issues:** it files, edits, comments on and closes the repository's issues and makes and lists its labels, never
  naming another repository. An issue filed with no milestone, no `bug` or `enhancement` label or not exactly one
  triage label is refused before anyone is asked (`issueGapsIn`, #324).
- **Reading GitHub:** `gh api` with GET only (#181).
- **Downloads:** a run's artifacts with `gh run download -D` into a folder git ignores that isn't a setup path,
  checked with `git check-ignore` (#202). What such a download brings is never run without asking: a package script
  in a folder git ignores (pnpm's `-C` or `--dir`, npm's `--prefix`), a test tool's config or root there, or a script
  or test there run with `node` asks, saying so (`ignored-folder`; each rule's `runsFrom`, read with `runsFromOf`,
  #219), as does one where git can't say (`gitIgnores`). `node --test` names its files, never leaving node to find
  them.
- **Flakes:** for a flake that isn't its PR's, it comments on its own PR with `gh pr comment` and re-runs one run's
  failed jobs with `gh run rerun <run> --failed`, and nothing more of a run (#356).
- **Reading a line:** a backslash at a line's end joins the next line on, and a title, body, message or jq filter is
  checked as a path only as a whole, so a link in it doesn't ask (#202).
- **A workspace's own:** a code workspace's `workspace.json` can add commands and remove default ones
  (`allowlist: { add, remove }`, built by `allowlistFor`), and keeps those the owner allowed always from an approval
  (`allowlist.always`, #185: each command's words, when, and from which session), never in the repository's own
  settings.
- **Allow always** (`alwaysOffer`): what it may offer for a command off the allowlist: its leading words, so the same
  command with other arguments doesn't ask again. Never for one naming a path outside the worktree, one of a default
  rule that failed its checks (or whose words could cover one, such as pushing), merging a PR, deleting a
  repository, release or ref, git's and gh's settings and sign-in, a program that runs another, or anything naming a
  credential.
- **Allow all for this task** (`allowsAll`, #428): whether it covers a command off the allowlist. Never one Allow
  always could never offer for the same reasons, nor gh's other commands (they act on GitHub, outside the session
  branch), publishing or signing in to a package registry, the machine's services and processes, options before git's
  or a package manager's command (`git -c … push`), or a runner's (`pnpm exec`, `npx`) whose own command isn't
  covered. Code given on the line (`node -e`, `python -c`, #464) is covered, as the same code saved in the worktree
  is: its text is read word by word for a path outside the worktree or a credential, and node's options that load
  other code first (`-r`, `--import`) or attach a debugger still ask. Of the setup files, it covers package scripts and git hooks,
  never git's own, `.github`, Claude Code's settings or a package manager's settings (`editPlaceIn`'s `all`). It
  checks commands as they're asked for: a script the session wrote and runs is its own code, as it is without Allow
  all.

### The turn's say: `CodeTurn`

- `sessions/` hands each code turn a `CodeTurn` (`providers/`), the worker's say on every edit and command, which
  records each one allowed as an activity and words each refusal through `prompts/`.
- It gives the environment its commands run in, with Courtyard's GitHub sign-in from `github/` (the module's own
  fetch from the remote uses it too).

### Slots: `slots.ts`

- Up to six code sessions run at once across the worker (#174, #364), each turn holding a numbered slot no other
  running one holds. A turn beyond that waits, first come first served, until one ends.
- Its commands get the slot as `COURTYARD_SESSION_SLOT`, with the worktree it's for as `COURTYARD_SESSION_WORKTREE`,
  which this repository's Playwright config picks its ports from (in that worktree only: a helper's own worktree
  picks them from its folder, #395), so side-by-side checks never share them.

### The builds queue: `builds.ts` (#281)

- The heavy checks `allowlist.ts`'s `isBuild` picks out: the package scripts `verify`, `test`, `e2e` and `build`, in
  any packages pnpm's workspace options pick, and `vitest run` and `playwright test`, run bare or through
  `pnpm exec`, `npx` or `pnpm --filter … exec`.
- They run up to `COURTYARD_BUILDS_AT_ONCE` at a time (1 by default) across every session, and one at a time in each
  session, whose helpers share its folder (#117), the rest waiting first come first served.
- That order lives in the worker's memory only. The build at its front then takes a place in the machine's builds
  lock (`packages/builds`, #306), which the repo's own scripts take too, so sessions also wait behind builds started
  outside Courtyard, and those behind sessions.
- **Tasks too** (#589): a heavy check run as a task waits for its place as any does, then keeps it past its turn,
  until the task ends (`taskEnded`); its commands get the held mark. Nothing a session runs gets round the lock.

### A Lead's builder's checks (#589, ADR 0031)

- `commandAllowed` with `builder` (a session the Lead started, `byLead`) refuses, before anyone is asked, a heavy
  check asked for as a task (`check-in-turn`: it runs in the turn) and one of a whole suite (`ci-runs-it`), which CI
  runs: `checksEverything`, a `verify` package script, or a `test` or `e2e` one, `vitest` or `playwright test` that
  names no test file (a `.ts`/`.js` file past the tool's options), at the root or in any package. Each refusal's
  words are `prompts/`'. The owner's own sessions are refused neither.
- It refuses a builder's `git push` to the default branch too (`default-branch`, #730): origin's HEAD, or `main` or
  `master`. A builder only ever pushes its own branch.
