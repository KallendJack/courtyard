# new-workspace

New workspace's form (#258, #264): Planning, or Code on one of your repos. The worker's side is
[`workspaces/`](../../../../worker/src/features/workspaces/README.md) and
[`repos/`](../../../../worker/src/features/repos/README.md).

**Example:** you switch to Code and pick `bike-log`. The name fills in as "Bike Log" and What's it for? as its GitHub
description; you check them and tap Create.

- **Uses:** `components/code/repo-picker.tsx`, `components/forms/`, `components/frame/` (`offerField`).
- **Used by:** the New workspace page (`routes/_app/new-workspace.tsx`), loaded with it.

## Screens

New workspace: a switch picks Planning or Code; Code lists the owner's repos, New repo first.

## How it works

- Its calls (`api.ts`) and a stylesheet of its own (`new-workspace.css`, holding the repo picker's classes too), like
  `features/pull-requests/`.
- Picking a repo fills in the name (title-cased from the repo's) and What's it for? (its description on GitHub), shown
  in full (`WrappingTextField`) before Create.
- **New repo** (#391): its name follows What's it for? (said or typed) until typed over, and its card's chips
  (private, the account, a Paper file) change with a tap.
- Name is focused on a desktop only, so a touch screen's keyboard waits for a tap.
- The page offers What's it for? to the frame's talk strip and Talk key (`handheld.ts`'s `offerField`), which put
  what's said there as they would in a message box.
- A code workspace just made opens with its Connections sheet (`#connections`), offering Paper, which Close skips
  (#308).
