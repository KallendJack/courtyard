# pull-requests

A code workspace's pull requests and their page (#160, #240, #278). The worker's side is
[`pull-requests/`](../../../../worker/src/features/pull-requests/README.md),
[`quick-questions/`](../../../../worker/src/features/quick-questions/README.md) and
[`sessions/`](../../../../worker/src/features/sessions/README.md) (a session's own PR).

**Example:** you tap Review on a PR. Its page shows What changed, the files as a tree beside the diff, and an ask
line; you ask "is the test new?", then Merge.

- **Uses:** `features/live/` (Update Courtyard's rule), `features/sessions/`, `components/code/` (`file-tree.tsx`,
  `ask-line.tsx`), `components/buttons/thumb-button.tsx`, `components/forms/select.tsx`.
- **Used by:** `features/code-home/` (Home's Needs you and the PRs tab), `features/home/` (`open-pull-requests.ts`),
  a workspace's page and the session page.

## Screens

- **The list** (`pull-requests.tsx`, the PRs tab's list, which shares its open pull requests with Home's Needs you
  through `open-pull-requests.ts`): every open PR on the repository, whoever opened it, with its title, branch, who
  it's from and where it stands (`checks.tsx`: moss passed, violet running, red failed, gold conflicting with its
  base), and Review, or Bring up to date when it conflicts; or its sessions' merged ones.
- **The PR page** (`review.tsx`): a session's PR on the session's page in place of the conversation
  (`?view=review`), and one no session opened on its workspace's page, named by the address's hash (`#pr-306`; a
  search value would add to the first load). Only this page lays itself out, fitting the screen.
- From a tablet up it fits one screen: All PRs, its title and where it stands, What changed (`what-changed.tsx`, its
  Summary's first line, and Read it all for the whole description, `description.ts`, in a panel that scrolls), the
  changed files as a tree (`components/code/file-tree.tsx`) beside the chosen file's diff (`diff.tsx`), each
  scrolling inside, the diff's lines never wrapping there. On a phone they wrap and the page scrolls as one.
- **The ask line** (`components/code/ask-line.tsx`: quick asks for where it stands and one line) asks quick questions
  (#327, `quick-questions.tsx`): the first opens the conversation on the page, beside the file list and the diff on a
  desktop, in the file list's and What changed's place on a tablet (the list folding into an "n of N files" switcher
  above the diff, `components/forms/select.tsx`'s `shown`), and as a sheet over the diff on a phone, with its own
  ask line, Merge and Close PR coming back once it closes. Its header names the model, and a line an answer points
  at shows marked in the diff with a tap. Follow-ups go in the same line, and Fix it in a session beside them
  carries the conversation over to the PR's session, or, with none, to a new one on its branch once the owner has
  seen what starts.
- **Merge**, or Bring up to date when it conflicts, and Close PR (`components/buttons/thumb-button.tsx`, shared with
  the approval card): beside the title on a desktop, in thumb reach on a tablet. A Merge that can't merge yet is
  greyed out but still takes a tap, which says why beside it (#329).
- **Merged or closed**, it folds to one card with what's next: Update Courtyard (when the worker is a live copy main
  has moved on from, unless main's build failed, by `live/`'s rule; tapped while it runs, it waits for it, #186),
  Start a new session and Show the changes.

## How it works

- A session's PR is asked for again as its session's events change it; one no session opened, every 15 seconds while
  it's open (#329).
- Its own lazy load, the list's with a code workspace's page, with its calls (`api.ts`) and a stylesheet of its own
  (`review.css`, holding the ask line's classes too), like `things/`.
