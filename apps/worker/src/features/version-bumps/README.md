# version-bumps

Dependabot's version bumps look after themselves (#496), as a red main does: a failed check is re-run once, then filed
for the Lead.

**Example:** Monday's routine bump fails its e2e check. The worker re-runs it; it passes, so the worker files "Flaky
e2e: a review shows its diff", `bug` and `ready-for-agent`, last in the current milestone's build order, and the bump
waits in Needs you as "From Dependabot · checks passed" with Merge.

- **Uses:** `code/` (each workspace's repository on GitHub), `github/` (pull requests, jobs, re-runs, issues,
  comments), `next-up/` (`build-order.ts`: filing first or last in the order), `workspaces/`.
- **Used by:** `worker.ts`, as one of its repeating jobs, once a minute; `pull-requests/`, for where each bump stands.

## API

None. `pull-requests/`' list carries each bump's standing (`bump` on `OpenPullRequest`).

## How it works

- Only pull requests Dependabot opened (`dependabot[bot]`): one the owner opened on GitHub is their work.
- **One re-run per commit:** a check fails on a bump's newest commit, and the worker re-runs the failed jobs once. A new
  commit from Dependabot (a rebase, an update) earns a fresh try.
- **Re-run passes:** the test is flaky, not the bump. It files "Flaky e2e: <test>" (the failure annotation the test
  reporters write on CI, else the job's name) last in the build order, or comments "Seen again on #<PR>" on the open
  one of that title.
- **Re-run fails:** it files "Bump fails: <PR title>" first in the build order, with the failing test and its job's
  link to the log, one per bump; a later failure on that bump comments on it instead.
- **The fix merged** (that issue closed): it comments `@dependabot rebase` on the bump. The Lead's fix goes to main on
  its own branch, never Dependabot's, or Dependabot stops rebasing it.
- **Still failing after the fix:** it stops; the bump goes to Needs you as "Still failing after fix · #<issue>" with
  Review, for the owner to keep going or close it.
- Where each bump stands, for the PRs tab and `waiting/`: **re-running** (not in Needs you), **fixing** with its issue
  (not in Needs you), **stuck** (Needs you's failed row), or nothing once its checks pass (Needs you's Merge, which
  the owner taps: a bump never merges itself).
- What it did about each open bump is kept in the data folder (`version-bumps.json`), so a restart never re-runs or
  files twice; a bump that's merged or closed is forgotten.
