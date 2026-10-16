# matt-setup

The setup check (#181, #323): what a code workspace's repository has of the house standard, and setting up the rest.

**Example:** a repo has no `docs/agents/` and no triage labels. Needs you offers the setup card; Set up makes the
labels, opens a pull request with the files, and makes its Paper file.

- **Uses:** `code/`, `github/` (labels, issues, the PR), `connections/` (the Paper file), `matt-skills/`,
  `workspaces/`.
- **Used by:** `worker.ts`, `repos/` (a new repo's files); in the web app, `features/matt-setup/`.

## API

- `GET`, `POST /api/workspaces/:id/matt-setup` (in `worker.ts`).

## How it works

- The house standard is Matt's `setup-matt-pocock-skills` with the house answers, worked out for any repository from
  its default branch on its remote through `code/`: its `docs/agents/` files and the Agent skills section, where its
  work lives (a backlog or TODO file, or `.scratch/`, and whether its instructions say another agent writes it), its
  glossary's name, the triage labels through `github/`, and whether `connections/` can make it a Paper file.
- Offered once, as one card with the standard recommended on each line; each answer is kept in the data folder's
  `matt-setup.json`.
- Set up as the owner chose, it makes the labels (only when its work lives on GitHub), files a moved tracker's open
  items as issues, puts the files (from his templates in the pinned copy and the house's own) on a branch of their
  own in a worktree in the data folder, pushes it and opens its pull request, then makes and connects the Paper file.
