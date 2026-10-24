# lead

A code workspace's Lead (#347): runs builders in the milestone's order, and merges in order when you say so.

**Example:** you tap Run the build order. The Lead starts a builder on the first ready issue, holds back the next one
because it changes the same file, and starts it once the first one's PR merges. Resting an hour later, it wakes when
you mark another issue `ready-for-agent`.

- **Uses:** `next-up/` (the order), `sessions/` (starting builders, merging, `stopBuilding`), `allow-all/`,
  `prompts/`, `providers/`, `workspaces/`; `code/`'s `changedFiles`.
- **Used by:** `worker.ts` (one of its repeating jobs); `live/`'s `holding()` stops it starting new builders.

## API

- `GET /api/workspaces/:id/lead`; `POST …/lead/run`, `…/lead/merge-in-order` and `…/lead/pause`.

## How it works

- Kept in the data folder's `leads.json`, one look each time the worker's jobs come round.
- **Merge in order** (#423, given the pull requests the owner's screen showed) is the owner's OK to merge those still
  ready, in the build order's order. Each look merges the first still open through `sessions/` once its checks pass
  and its session's turn is done, waits while the worker brings one that conflicts up to date (#382), and stops,
  saying which and why in its chat, at a failing check, a conflict its session left or GitHub's refusal
  (`LeadStatus.merge`; forgotten once that pull request is merged or closed some other way).
- **Held back:** it holds back a ready issue naming a code file (by path, or by a name few folders share) that a
  builder still at work changes (`code/`'s `changedFiles`: committed since the default branch, changed and new in its
  worktree) or whose issue named it, never main's fix, starting it once that builder's pull request merges. It
  doesn't rest while one is held back (`LeadStatus.heldBack`; Next up says "Held back").
- **A window, with brakes** (#457): Run the build order says how long it keeps going (`LeadRun.keepGoing`: just
  what's ready now, 4 hours unless said, or until 22:00 on the worker's clock), kept as `wakesUntil`. Within it, a
  resting Lead looks each time round for an issue Next up offers to build (one made ready, a claim freed, a blocker
  closed, a clash merged) and wakes only once a builder starts, noting "Woke: #… is ready, started building."; until
  then it says nothing. Grills are never started. On top of the code sessions' slots (`LEAD_BRAKES`), no builder
  starts while 2 of its pull requests wait on the owner's review, and after 4 builders a run it rests ("Built 4 this
  run · tap Run for more"), waking for nothing until the owner runs it again.
- **Allow all:** it keeps the end of Allow all for builders (`allowAllUntil`, 12 hours from the owner's Run the build
  order with it on) and starts each builder with it until then.
