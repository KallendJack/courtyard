# next-up

A code workspace's Next up (#301): the ready issues nobody has claimed, in the milestones' order, with Build and
Grill; and its Roadmap (#532): every open milestone with all its issues, each in one plain state.

**Example:** Next up lists "Add a dark scrollbar" first. You tap Build; a code session starts on it, and the issue
gets "Building this: …" with the session's branch.

- **Uses:** `github/` (issues, comments, milestones), `sessions/` (starting a session), `prompts/` (its first
  message), `code/`, `workspaces/`.
- **Used by:** `worker.ts`, `lead/` (the order, `filesNamed`), `red-main/` and `version-bumps/` (the order rules,
  and `build-order.ts`, which files an issue first or last in the current milestone's order); `sessions/` is handed
  its `named`, `claim` and `release`.

## API

- `GET /api/workspaces/:id/next-up`; `POST …/next-up/:number/build` and `…/next-up/:number/grill`.
- `GET /api/workspaces/:id/roadmap` (#532).

## How it works

- **What's listed:** its repository's open `ready-for-agent` issues through `github/`, less those claimed (a comment
  starting "Building this" that no later "Stopped" released, or an open pull request that closes it).
- **The order:** milestone order (the number a milestone's title leads with, then Later, then none) and, inside a
  milestone, the order its description's `Build order:` line lists (a note in brackets before its colon is read too,
  #687), the rest by number (#336). The line only orders: it never decides what shows (#463).
- Asked of GitHub only when a page asks, and kept two minutes.
- **GitHub refuses** (#519): when GitHub's hourly allowance is used up, or the read fails another way, `GET …/next-up`
  still answers 200 with the last list known and `unread`: `rate-limited` with `backAt` (from GitHub's
  `x-ratelimit-reset` or `retry-after`), or `unreachable`, each with `asOf`, when that list was read (`null` when
  none is known yet). Home shows it as one grey line; a refused read is never shown as no work. The
  Lead reads through `list` and `fresh`, which still fail.
- **Build** (#298) asks again and starts a code session through `sessions/` on the issue, whose first message is the
  issue (`buildIssueMessage`, worded by `prompts/`).
- **Claims** (#324): every session started on an issue has its claim posted here. `sessions/` is handed `named`,
  `claim` and `release`, and keeps the claim in the session's file. It claims as the session starts (Build's issue,
  else the one ready issue nobody has claimed that its first message names as `#<number>`), naming its branch. It
  releases the claim ("Stopped: <why>") when a turn is stopped or fails, or the session is deleted, before it has a
  pull request, and claims again when it carries on. The Lead's skip releases through `sessions/`' `stopBuilding`.
- **Grill:** Next up also lists, not `ready`, every open `needs-triage` and `needs-info` issue, in its place
  (#363, #463), never as blocked: one can be grilled before what it waits on is done. Grill starts a code session with the grilling skill whose first message
  is the issue (`grillIssueMessage`), claims nothing, and starts it `placeless`: its session file says so, and its
  turns take no slot in `code/slots.ts`.
- **The Roadmap** (#532, `roadmap.ts`): every open milestone through `github/`'s `roadmap`, each with all its
  issues, open and closed, in the milestones' order (Later last); inside one, its `Build order:` line's order, the
  rest by number, done ones last. Each issue has one state, worked out here with Next up's own rules: closed is
  `done`; claimed, or closed by an open pull request, `building`; `needs-triage`, `needs-info` or no ready label,
  `to-grill`; blocked by an open issue, `blocked` with its title as `after`; else `ready`. It has its summary (its
  description's first paragraph that isn't a heading) and the boards its Boards section quotes. Kept two minutes, and
  a read GitHub refuses answers the last known with `unread`, as Next up does.
- **Files named:** it keeps the code files each ready issue names in its description or comments (`filesNamed`,
  #423), for the Lead.
