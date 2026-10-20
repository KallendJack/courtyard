# lead

A code workspace's Lead (#347): runs builders in the milestone's order, and merges in order when you say so.

**Example:** you tap Run the build order. The Lead starts a builder on the first ready issue, holds back the next one
because it changes the same file, and starts it once the first one's PR merges.

- **Uses:** `next-up/` (the order), `sessions/` (starting builders, merging, `stopBuilding`), `builders/` (each
  builder's status, which it decides from and serves as `LeadStatus.statuses`), `allow-all/`,
  `prompts/`, `providers/`, `workspaces/`; `code/`'s `changedFiles`.
- **Used by:** `worker.ts` (one of its repeating jobs); `live/`'s `holding()` stops it starting new builders.

## API

- `GET /api/workspaces/:id/lead`; `POST …/lead/run`, `…/lead/merge-in-order`, `…/lead/allow-all` (`{ on }`) and
  `…/lead/pause`.

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
- **Keeps going for a window** (#457): Run the build order says how long (`LeadRun.window`): just what's ready now,
  4 hours (the default, and what a Run that doesn't say opens unless a window is still open) or until 22:00 on the
  worker's clock. Within it (`wakesUntil`), a resting Lead looks each time round and wakes once an issue it would start
  is buildable, saying "Woke: #N is ready, started building." in its chat; after it, it rests until the owner runs it
  again. Grills are never its own: only `ready-for-agent` issues are built.
- **Brakes** (#457): no new builder while 2 of its builders' PRs wait on the owner's review (holding back, carrying on
  as they merge), and at most 4 builders a Run, after which it rests ("Built 4 this run · tap Run for more"), its
  window closed.
- **Each builder's status** (#590, `builders/`): it decides from that alone, never from a session's event log. A
  Stuck builder (its turn failed or was stopped, it ended two turns with nothing to show, a restart cut it off twice,
  or its pull request was closed) leaves Building, its slot free; its session is kept and its claim stands, and it
  waits in Needs you saying why (`waiting/`). A Merged one is done with once the Lead has been told. Ready for
  review is its pull request ready to merge; every other status is Building and holds its slot. One started before
  statuses were kept is read from its pull request until something happens in it. Nothing stalls: there's no
  timer.
- **Allow all:** it keeps the end of Allow all for builders (`allowAllUntil`, 12 hours from the owner's Run the build
  order with it on) and starts each builder with it until then. The owner can switch it from the Lead's row while it
  runs, is paused or rests (#551): on gives it, for 12 hours, to its builders still building (no pull request yet) and
  any it starts, answering the approvals they wait on that it covers (`LeadStatus.allowAllReaches` counts both, for
  the sheet); off ends it on the builders the Lead gave it to (`byLead`), never one the owner turned on themselves.
