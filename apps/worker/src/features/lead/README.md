# lead

A code workspace's Lead (#347): runs builders in the milestone's order, and merges in order when you say so.

**Example:** you tap Run the build order. The Lead starts a builder on the first ready issue, holds back the next one
because it changes the same file, and starts it once the first one's PR merges.

- **Uses:** `next-up/` (the order), `sessions/` (starting builders, merging, `stopBuilding`), `builders/` (each
  builder's status, which it decides from and serves as `LeadStatus.statuses`), `allow-all/`
  (each builder's Allow all, until its pull request opens), `prompts/`, `providers/`, `workspaces/`; `code/`'s
  `changedFiles`.
- **Used by:** `worker.ts` (one of its repeating jobs). An Update waiting holds none of its builders back (#591).

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
- **Its rules** (#591, ADR 0031): at most 2 builders at once (`LEAD_BUILDERS`, 1 if the owner says), only issues in
  numbered milestones (never Later, or one with none), and only `ready-for-agent` ones (grills are never its own).
  It holds back while 4 of its builders' pull requests wait for the owner's review (carrying on as they merge),
  while one of its builders waits for its model's usage limit (until the reset), while main is red (starting only
  its fix), and while the owner's own sessions leave one place free; what waits on the owner holds back only its own
  builder, and an Update waiting holds back nothing. With nothing ready it rests, and starts again as soon as
  something is, through the night: there's no window and no cap on a Run.
- **Paused** (#591): its builders carry on and nothing new starts, and it takes no turn of its own: a builder's
  merge waits (`LeadStatus.toTidy` counts them, its row says "N merges to tidy") until it runs again, when it tidies
  up after each.
- **Each builder's status** (#590, `builders/`): it decides from that alone, never from a session's event log. A
  Stuck builder (its turn failed or was stopped, it ended two turns with nothing to show, a restart cut it off twice,
  or its pull request was closed) leaves Building, its slot free; its session is kept and its claim stands, and it
  waits in Needs you saying why (`waiting/`). A Merged one is done with once the Lead has been told. Ready for
  review is its pull request ready to merge; every other status is Building and holds its slot. One started before
  statuses were kept is read from its pull request until something happens in it. Nothing stalls: there's no
  timer.
- **Allow all:** every builder starts allowing all until its pull request opens, 12 hours at most (`allow-all/`'s
  `task`), covering what Allow all always covers (#428); the Lead has no switch of its own (#591).
