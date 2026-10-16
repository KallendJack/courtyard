# repos

The owner's GitHub repos as code workspaces (#258): New workspace → Code's list, and New repo.

**Example:** in New workspace → Code you pick `bike-log`. It's cloned onto the worker machine and a code workspace is
made on it.

- **Uses:** `github/` (the repos, and the environment for git), `code/`, `workspaces/`; `matt-setup/` and
  `connections/` for a new repo, through `worker.ts`.
- **Used by:** `worker.ts`; in the web app, `features/new-workspace/`.

## API

- `GET /api/github/repos`: the list.
- `GET`, `POST /api/github/repos/new` (in `worker.ts`): the account and whether Paper can be made, and New repo.
- `POST /api/workspaces` with a `repo` checks the name is free, places the repo, then makes the workspace on it.

## How it works

- Lists the repos `github/` gives, newest pushed first, each marked added when a code workspace works on it already
  (its repository is that repo's folder here, or its `origin` is that repo on GitHub, read through `code/`), the
  added ones last.
- Gets a picked repo onto the worker machine, one at a time: a clone into the data folder's `repos/<owner>/<name>`
  with the environment `github/` gives code sessions, so git asks Courtyard's sign-in through `gh` and no token is
  kept in the address or git's settings. A copy already there is used as it is.
- Refuses a repo the GitHub App doesn't reach or that a code workspace works on already.
- **New repo** (#391) makes one on the account signed in through `github/` (empty, private unless asked), then its
  folder here with its first commit, the house standard's files `matt-setup/` gives, as Courtyard's own commit,
  pushed to `main`. It refuses a name the owner has a repo by already. `matt-setup/` then gives it the labels, its
  first milestone and its first idea as an issue needing a grill on that milestone's Build order line, and the
  route makes the workspace on it and, when asked, its Paper file through `connections/`.
