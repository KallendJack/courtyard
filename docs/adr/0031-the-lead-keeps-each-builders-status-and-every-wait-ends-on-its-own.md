# The Lead keeps each builder's status, and every wait ends on its own

Decided with the owner on 2026-10-20, after the owner paused the Lead because it felt clogged. Amends ADR 0027 for the
Lead's builders, and ADR 0011's Update when ready. The Lead (#347) had no ADR of its own: each of its rules was added
for one incident (the stall timer and its exceptions, the window, the brakes, Allow all for builders), and about half
of the pull requests from #437 to #582 went on the build machinery itself.

The event logs of the 46 builders the Lead started from 15 to 20 October showed where their time went: about 11 hours
of the model working against about 61 idle with no pull request (a long check outlived its turn and nothing woke the
builder, or its end was dropped while an Update waited), 37 waiting on approvals (29 of them three asks left
overnight), 32 failed at the usage limit and never retried, and 30 with a pull request waiting overnight. Every full
`pnpm test` a builder ran as a task failed (14 of 14), and three at once took 26 to 49 minutes each, because tasks and
package-level test runs skipped the machine's builds lock. Neither the slots nor the restarts held anyone up.

So:

- **Every Lead builder is always in one of eight statuses**, each with the time it began: **Building** (the model is
  working), **Checking** (a check runs, or waits its turn in the lock, saying its place), **Waiting on you** (a question
  or an approval, naming it), **Waiting for the limit** (until its reset), **In CI** (its pull request's checks run),
  **Ready for review**, **Merged**, and **Stuck** (Courtyard gave up, saying why in plain words). A failing check is
  Building again, as the builder fixes it. The worker records the status as things happen and keeps it in the data
  folder; the Lead, the Builders board, Needs you and the Home tiles all read it. Nothing re-reads an event log to
  guess it.
- **Every wait ends on its own.** A check's end always wakes its builder, Update or not. A turn that ends with no pull
  request and no question gets one "carry on"; ending so again, it's Stuck. One at the usage limit carries on at the
  reset, and the Lead starts no new builder until then. A turn a restart cut off, whatever the restart, carries on by
  itself once. The 20-minute stall timer goes.
- **Builders check only what they changed.** Their own unit test files and browser specs, with check and typecheck,
  inside the turn, one at a time through the machine's builds lock, with nothing that gets round it. A check still
  running after 10 minutes is stopped, and the builder told to narrow it. The full suite, the full browser suite and
  `verify` are CI's: a builder asking for them is refused, told CI runs them. Tasks are for previews and dev servers
  only, and end with their builder.
- **What waits holds back only itself.** An approval waits on its own builder; the others carry on. A builder starts
  with Allow all on. The Lead keeps at most 2 builders at once and pauses itself at 4 pull requests waiting for the
  owner's review, with no window and no cap on a Run, so it builds through the night. Update when ready holds nothing
  back: it waits only for a check that's running, then restarts.
- **Builders start no helpers.** The Lead's builders are its parallel work; the owner's own code sessions keep their
  helpers (ADR 0027).
- **One Builders board** on a code workspace's Home shows the Lead's builders, one row each (its issue, its status and
  since when, what it's doing now, and one action), every reason the Lead isn't starting more, and what's next. Needs
  you shows the same row for one Waiting on you or Stuck. The owner is notified when a builder waits on them, when one
  is Stuck, and when the Lead pauses itself; not for each pull request ready for review.

Holding an issue back while a builder changes its files, and Merge in order, stay as they were.

## Considered options

- **Fix each incident as it comes, as before.** Rejected: each fix added a rule the others didn't know about, the
  owner could see only one of them at a time, and seven more such issues were queued.
- **More builders, or more builds at once.** Rejected: the time wasn't lost in the queue (about 8 hours) but in
  builders nothing woke, and full suites side by side made every check slower and flakier.
- **A shorter stall timer.** Rejected: it guessed from silence. A builder waiting on its own check looked stalled, and
  each false Stalled freed a place the Lead filled with another builder, adding load.
- **Helpers in builders, as in the owner's sessions.** Rejected: they add parallel coding but not parallel checks (one
  check at a time per session), and make a turn longer and easier to lose.
- **Keep the 22:00 window.** Rejected: the owner wants the morning to bring pull requests to review, and the review
  budget of 4 already stops it outrunning them.

## Consequences

- **Fewer checks on the PC, more in CI.** A builder may push with a failure only the full suite would find; CI finds
  it and the builder fixes it as Building.
- **One state machine to keep right**, in the worker, in place of the stall timer, its exceptions and the Lead's
  guesses. Each status's way out is tested.
- **Allow all by default** covers only what it already covers (ADR 0008, #428): anything outside the worktree, or acting
  on GitHub beyond the session's own pull request, still waits on the owner, but now only that builder waits.
- **A night's run can leave up to 4 pull requests** and each builder in a status that says what it needs.
- The words Stalled, Held back, Holding back, Resting, Wakes, Keep going and Allow all for builders leave the app
  and the glossary; an issue held back shows as "Next · waits for <name> to merge".
