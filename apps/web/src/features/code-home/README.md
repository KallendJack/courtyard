# code-home

A code workspace's page under its name (#301, #308; Paper, "Code workspace Home").

**Example:** the Courtyard workspace opens on Home: Needs you has one PR ready to merge, Running shows two builders,
and Next up offers Build on the next issue.

- **Uses:** `features/pull-requests/`, `features/live/`, `features/matt-setup/`, `features/sessions/`,
  `components/layout/home-block.tsx`, `components/code/`, `components/workspace/`. The worker's side is
  [`waiting/`](../../../../worker/src/features/waiting/README.md),
  [`next-up/`](../../../../worker/src/features/next-up/README.md),
  [`workspace-main/`](../../../../worker/src/features/workspace-main/README.md) and
  [`connections/`](../../../../worker/src/features/connections/README.md).
- **Used by:** a workspace's page, loaded only for a code one; `features/home/` and `features/sessions/` (`needs.ts`).

## Screens

- **Its name**, with one quiet ⋯ beside it (`components/workspace/workspace-menu.tsx`: Rename, Change icon and
  Archive, #333), then its connections line under it; from a tablet up its tabs share the name's row, before the ⋯
  (#503). Its one line stays in `workspace.json`, off the page.
- **The Connections sheet** (`connections.tsx`): GitHub, and the Paper file to pick (the one named after the
  workspace picked already), or make; opened by itself as `#connections` right after New workspace → Code.
- **Tabs:** Home · Roadmap · Sessions · PRs, by the address's hash (`#roadmap`, `#sessions`, `#prs`). Roadmap is
  always there; Sessions and PRs once they have something (the Sessions tab is `sessions/session-links.tsx`, the PRs
  tab `features/pull-requests/`' list). PRs keeps its place, unseen, until it's known to have some, so the tabs never
  move as it loads.
- **The Roadmap tab** (`roadmap.tsx`, #532; Paper, "Roadmap"): every open milestone in the roadmap's order, Later
  last, each a row with its progress bar (done of all) and how many are left; the current one (the first with open
  issues) open and marked Now, the others folded until tapped. Inside, its issues in its Build order with the state
  the worker gave each (Building, Ready, To grill, After …, Done); past the first six open ones, the rest and the done
  ones fold into one row. Tapping an issue opens its summary, the boards its description names (opening the
  workspace's Paper file when it has one) and its link on GitHub. Read-only.
- **Home's blocks**, in a fixed order, each keeping its place when empty with one quiet line
  (`components/layout/home-block.tsx`, shared with a planning workspace's Home): Needs you (`needs-you.tsx`: approvals
  with Approve, failing checks, new replies, pull requests ready to merge with Merge, conflicts with Bring up to
  date, and the setup check's offer), Running (`running.tsx`), Next up with Build, or Grill on top (`next-up.tsx`), the milestone beside its label,
  then one faint Then line naming the next titles and Whole roadmap · N more, which opens the Roadmap tab (#532);
  when GitHub refused the read, the last list known with one grey line saying why, as the worker says it, #519),
  Main (`main-row.tsx`: the repository's newest main commit with `live/`'s build bar, and Update only on the live
  copy's own repository), then the message box, pinned at the foot.
- From a tablet up the page is the screen's height and never scrolls, the blocks sharing the height left and their
  rows scrolling inside their cards through its `BlockRows` (#335).

## How it works

- Its calls (`api.ts`) and a stylesheet of its own (`code-home.css`, holding the classes of the shared pieces only
  the two Homes show: `workspace-tabs.tsx`, `home-block.tsx`, `connections-line.tsx`, `radio-row.tsx`, the thumb
  buttons and `row-button.tsx`), like `features/pull-requests/`.
- **Nothing jumps in late:** each block that loads after the page keeps its last answer for the tab's lifetime
  (`components/layout/kept.tsx`), so a revisit shows it at once and asks again quietly, and a first visit shows faint
  placeholder rows in its place; the PRs list does the same.
- That GitHub isn't connected comes with the connections line, from the workspace's own connections.
- **What waits on the owner** is the worker's say (`waiting/`, on each listed session and open pull request), read in
  one place, `needs.ts`, with no React or styles, so the home page's tiles read it the same way; nothing in the web
  app works it out.
- Merge in order (`merge-in-order.ts`) hands the Lead the pull requests the screen showed.
