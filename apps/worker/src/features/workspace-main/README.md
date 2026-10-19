# workspace-main

A code workspace's main, for its Home's Main row (#301).

**Example:** the Main row shows main's newest commit, "Fix the scroll fade", with its build running in stages.

- **Uses:** `code/` (fetching), `github/` (`mainBuild`, #249), `workspaces/`.
- **Used by:** `worker.ts`, `friction/` (`liveRepo`, the live copy's repository); in the web app, `features/code-home/` (`main-row.tsx`).

## API

- `GET /api/workspaces/:id/main` (in `worker.ts`).

## How it works

- The default branch's newest commit, freshly fetched through `code/`, and its build as `github/`'s `mainBuild` reads
  it, kept a minute (8 seconds while it runs).
- Whether the repository is the one the live copy runs from, so Update shows only there.
