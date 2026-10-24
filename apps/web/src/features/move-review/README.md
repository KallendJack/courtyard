# move-review

A planning workspace's move review on Home (#603, ADR 0032): each move the worker proposes, ticked, and Move N. The
worker's side is [`move-review/`](../../../../worker/src/features/move-review/README.md).

**Example:** Mountain biking's Home says "Your guides, sorted · Move 5 things where they belong", then five ticked
rows ("MTB journey guide → a project", "Day one guide → archive", …). The owner unticks one and taps Move 4: four
changes, each with Undo in Recent changes, and Home is the bike and its projects again.

- **Uses:** `components/forms/tick-box.tsx` (each row's tick, big), `packages/ui/buttons/button.tsx`,
  `features/planning-home/` (Home again once it's done).
- **Used by:** `features/planning-home/` (Home, while the review waits on the owner).

## Screens

- **The move review** (`move-review.tsx`; Paper, "Tablet · Move review: guides to projects and parts, ticked
  (#603)"): in place of Home's subject and projects, its caption and title, a row for each move (what moves where,
  in bold, and what it becomes), each ticked to begin with, then **Move N** and "Untick any to leave as it is · each
  move has Undo". With none ticked the button reads **Leave as they are**, which ends the review with nothing moved
  (not on the board). A move that couldn't be made says why under it, and stays.

## How it works

- Home brings the review (`PlanningHome.review`), so it's there from Home's first frame once it's been written.
- Move N sends the ticks (`api.ts`), then asks for Home again.
