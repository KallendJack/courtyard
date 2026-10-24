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
  alone. A `..` path counts as inside when it stays inside from the folder of a file the code names, which covers an
  import written into that file.

## Consequences

- Fewer approvals for the owner and none for routine builder work, so nights' runs no longer stop on them.
- Still asking, from the same logs: GitHub writes through `gh api` (milestones' build orders, about a hundred asks),
  `gh api graphql`, and reading outside the worktree (the data folder, Claude Code's own task output in the temporary
  folder). They're outside the worktree, so they stay major; a later issue can decide them.
- Code given on the line is checked by its words, so code that builds a path outside the worktree from parts isn't
  caught; that was already true under Allow all, and the session is still held to its worktree's files by everything
  else.
