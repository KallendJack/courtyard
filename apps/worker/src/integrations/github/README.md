# github

The only place that knows GitHub (#99).

**Example:** you sign in from Connections with a device code. From then on code sessions' `gh` and `git push` use
Courtyard's own sign-in, never the machine's.

- **Uses:** GitHub itself, a dependency passed in.
- **Used by:** `code/`, `sessions/`, `pull-requests/`, `next-up/`, `red-main/`, `repos/`, `matt-setup/`,
  `connections/`, `workspace-main/`, `live/` (through `worker.ts`); in the web app, `features/sign-ins/`.

## API

- `GET /api/github`, `POST …/sign-in`, `…/cancel` and `…/sign-out`.

## How it works

- **Signing in:** through a GitHub App the owner registered and installed on the repos they chose: a device code from
  Connections, then the token kept in the data folder (`github/sign-in.json`), refreshed by a repeating job before it
  runs out, and forgotten when GitHub stops taking it.
- **GitHub itself** is a dependency passed in: `api.ts`, the one real one; `fake.ts` holds it in memory for the tests
  and the browser tests.
- **GitHub's hourly allowance** (5,000 requests, #520): the worker asks the same things every 30 s or so (Next up and
  each issue's comments for the Lead, each session's pull request and its checks), so `api.ts` keeps its last 1,000
  answers with their ETags and asks again with them. GitHub answers an unchanged one 304 and doesn't count it, so only
  what changed costs a request. `test/github-requests.test.ts` counts them against a stand-in GitHub.
- **Code sessions' environment** (`commandEnv`): `gh` reading Courtyard's own config folder, git's credential helpers
  replaced by `gh`'s and GitHub's SSH addresses turned to HTTPS, and every variable naming the machine's own login
  unset. While no one is signed in, that folder holds a stand-in that works nowhere, since `gh` would otherwise fall
  back to the machine's keyring.
- **Pull requests:** reads a branch's latest pull request and the checks on its latest commit (#172), the files it
  changes with their diffs, and merges and closes it (#160); reads a pull request by its number and lists a
  repository's open ones, with each one's branch, author and whether it conflicts (#278); opens a pull request.
- **Issues and labels:** lists and makes a repository's labels (the setup check, #181); lists a repository's open
  issues with a label, with their milestones and comments, and its open pull requests' titles and descriptions, and
  comments on an issue (Next up and Build, #301); lists and describes milestones, and files an issue (#355).
- **Repos:** lists the repos the GitHub App reaches, with each one's description and where git clones it from (#258).
- **Main's build** (#249), in stages (#337, `main-build.ts`): the latest try of each job, placed by the workflows
  that ran on the commit (their files as they were there, read by `workflow.ts`, which reads only each job's name,
  `needs:` and matrix): a job after the jobs it needs, a matrix's runs folded into one row, a job with no run yet
  waiting; the failed one's page; and when a running one should end, from the middle of each job's own last five
  passing runs on main's earlier commits (kept once finished).
- **Red main:** re-runs a commit's failed jobs, and reads the failing test a job's annotations name.
