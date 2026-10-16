# red-main

A red main after a merge (#355): re-runs its failed jobs once, then files an issue.

**Example:** after a merge, main's e2e job fails twice. An issue "Fix: chat scrolls on load" is filed, `bug` and
`ready-for-agent`, first in the lowest open milestone's build order.

- **Uses:** `code/` (fetching the default branch), `github/` (jobs, re-runs, issues), `next-up/` (the order rules),
  `workspaces/`.
- **Used by:** `worker.ts`, as one of its repeating jobs, once a minute.

## API

None.

## How it works

- Each code workspace's default branch, freshly fetched through `code/`, and the jobs on its newest commit through
  `github/`.
- Failed, the worker re-runs the failed jobs once, by itself.
- Failed again (or GitHub refused the re-run), it files a `bug`, `ready-for-agent` issue named after the failing test
  (the first failure annotation on the job, which the test reporters write on CI, else the job's name) with the
  job's link, in the lowest-numbered open milestone, and puts it first in that milestone's `Build order:` line.
- What it did for each repository's newest commit is kept in the data folder (`red-main.json`), so a restart never
  re-runs or files twice.
- No session waits on main.
