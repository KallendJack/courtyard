# Only major actions ask, and the Lead's builders allow all for their issue

Decided with the owner on 2026-10-24 (#730), after a builder waited 3 hours on one approval (a `node -e` script editing
its own worktree) while the owner was out, and Fabrication stopped. Adds to ADR 0031 (the Lead's builders) and ADR
0008 (what needs an approval). The owner's words: "Make sure we only need approval for major tasks, nothing that
happens constantly."

The session logs of the 14 days before showed what asked. Most was routine work inside the session's own worktree:
code given on the line (`node -e`, about 80 asks), test runs told their port or screenshots' folder (`PORT=4392 pnpm
exec playwright test …`), moving and removing files (`git mv`, `git rm`, `rm`, `mkdir`), a bare `git push`, other
check scripts (`pnpm lint`, `pnpm run test:e2e`), `date` and `sleep`, the repository's own issues named with
`--repo`, and false alarms: an import path a script wrote into a file read as a path it opened, a search's pattern
read as a path on Windows, a pnpm `-C` folder's `../../test-results` read from the worktree's root. Builders also lost
Allow all as soon as their pull request opened, so fixing its checks asked again.

So:

- **Routine work inside the worktree never asks**, for every code session, the owner's too: editing, moving,
  generating and removing its files (code given on the line included, as Allow all already read it), the repository's
  check scripts by name, restoring files and bringing the branch onto its base, `git` add, commit and push to the
  session's own branch, and reading anything in the worktree. Each kind found in the logs is covered, with a test.
- **Major actions still ask:** anything outside the worktree; pushing anywhere but the session's own branch, force
  pushing, deleting a branch or repository; merging a pull request; anything naming a credential; publishing or
  releasing; the machine's services and processes; and editing a file that decides what runs (`package.json`, git
  hooks, `.claude`, `.github`, git's own `.git`).
- **A builder the Lead starts allows all for its issue**, from its first turn until its pull request merges or closes
  (a week at most), its pull request opening or not. Its row on the Builders board and its session say so, and Turn
  off ends it for that builder alone, which then asks again. The owner's own sessions are unchanged: they allow all
  only when the owner turns it on.
- **A builder's push to the default branch is refused**, before anyone is asked: a builder only ever pushes its own
  branch, and its pull request takes the work there.

## Considered options

- **Allow all for every session by default.** Rejected: the owner's own sessions are watched as they run, and asking
  there for what's major is the point; routine work no longer asks anyway.
- **Keep the builder's Allow all ending at its pull request.** Rejected: after the pull request opens a builder still
  fixes failing checks and conflicts, unattended, which is when it waited.
- **Check only the paths code given on the line opens.** Rejected for now: the worker can't tell from the text
  alone. Every path is taken from the worktree, which the code runs in, with one exception: a relative import inside
  one of JavaScript's strings (`"import { ok } from \"../../lib/result.ts\""`), text the code writes into a file,
  counts as inside when it stays inside from the folder of a file the code names. A path given to the file system's
  or path's functions never does.

## Consequences

- Fewer approvals for the owner and none for routine builder work, so nights' runs no longer stop on them.
- Still asking, from the same logs: GitHub writes through `gh api` (milestones' build orders, about a hundred asks),
  `gh api graphql`, and reading outside the worktree (the data folder, Claude Code's own task output in the temporary
  folder). They're outside the worktree, so they stay major; a later issue can decide them.
- Code given on the line (`node -e`, `python -c`) now runs without asking in every code session, the owner's too,
  when its words name no path outside the worktree, no credential, no setup file, and nothing that runs another
  program or reaches the network: `child_process`, spawn, exec and fork, worker threads, `fetch` and sockets
  (`http`, `https`, `net`, `dgram`, `tls`), node's bindings and native modules, `vm`, `eval`, a `require` or
  `import` of a name it works out, Bun's and Deno's own calls; Python's `subprocess`, `os.system`, sockets and the
  web. Perl's, Ruby's and PHP's always ask. Under Allow all the same code asks.
- That is a check of what the code says, not of what it does. JavaScript is read with a parser since #747 (paths
  only from its strings, what runs only from its names, members and calls; code that doesn't parse asks), other
  code by its words. Code that builds a path from parts it works out (`path.dirname(process.cwd())`) or
  reaches a function by a route the lists don't name can still read, write or delete outside the worktree, or run a
  program, without asking. So can a script or test the session writes and runs (`node scripts/x.ts`, `pnpm test`),
  as before this decision. The checks catch a model's mistakes; they don't hold a model trying to get past them.
- Allow all covers any other command off the allowlist whose words name no path outside the worktree (braces
  expanded as the shell does) and that isn't on its lists: `curl`, `cargo`, `pnpm add` and other programs, network
  included, run without asking while it's on, for a builder all its issue long. An environment in front of a command
  other than a test run's (`PORT`, `CI`, `TZ`, colours, `COURTYARD_E2E_SHOTS`) always asks, and a builder's push to
  the default branch is refused whatever environment it's given.
