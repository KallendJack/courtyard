# The Lead reviews, fixes and merges its builders' pull requests

Decided with the owner on 2026-10-24 (#734, grilled Q1 to Q14). Amends ADR 0031: a Lead builder's pull request is no
longer left for the owner to review and merge. ADR 0033 still holds: nothing merges without green checks.

On 24 October Claude Code did this job by hand while the owner was out: it reviewed each builder's pull request,
fixed what the reviews found, and merged. The reviews caught real problems in four of them: #725 changed Courtyard's
look, #723 could lose unpushed work, #732 left Builds unfinished (and Codex never saved a Build), and #733 opened holes
in the approvals. Courtyard on its own would have merged them unread on the owner's tap, or left them waiting for the
owner. This makes the Lead do that job itself.

So:

- **Always on.** There is no away switch: reviewing, fixing and merging is how the Lead works, whether the owner is
  there or not. The owner can still stop the Lead.
- **A reviewer on every pull request.** A fresh Claude session per pull request checks it against its issue, the
  agreed board, the ADRs and the house rules, and adds a security pass when it touches approvals, sign-in, secrets, or
  code that deletes or pushes. It works in its own throwaway worktree, where it may build, run `check`, `typecheck`
  and unit tests, and try commands to prove a hole. It never pushes and never runs the browser tests. It reviews every
  pull request, the owner's own sessions' too, and takes one of the Lead's builder slots, so no more than 2 run at
  once.
- **Conduct tests count as review.** When a pull request changes what models are told or how they behave, the tests
  its issue names run 3 times on Claude and 3 times on Codex, and their result is part of the review.
- **The builder fixes the findings.** The Lead sends them to the builder; a new session on the branch takes over only
  if the builder's session has ended. A builder may reject a finding with its reason, and the reviewer re-checks it in
  the next round. Each review and the fixes after it is one **fixing round**. After 3 rounds that don't pass, the pull
  request goes to the owner in Needs you, with the open findings and both sides of each.
- **The Lead merges** when every check is green and the latest review passed, with a merge commit, in build order.
  A pull request left with a conflict is brought up to date with main by its builder, then goes through checks and a
  review of the change again. Only pull requests from builders the Lead started merge this way; the owner merges their
  own sessions' pull requests, after the same review.
- **Red main and flaky checks.** Fixing a red main takes the next free builder, ahead of everything, without stopping
  one that's working. A check that fails in a test the pull request didn't touch re-runs once; a second failure is
  real. A branch behind main that fails is brought up to date with main first (this takes in #721).
- **What the owner sees.** A phone notification only when something needs them, and one line per pull request on the
  Builders board ("merged after 1 review", "fixing review · round 2"). The board's new states get a Paper board the
  owner OKs before they're built.
- **When.** After 3 · Fabrication's key features: builders take these slices (#735 to #740) only when no Fabrication
  slice is ready. Until they're built, Claude Code does this job by hand.

What still comes to the owner: a pull request after 3 fixing rounds that don't pass, the owner's own sessions'
pull requests to merge, and everything that already waits on them (approvals, questions, a Stuck builder).

## Considered options

- **An away mode the owner turns on.** Rejected: the job is the same whether the owner is there or not, a switch is
  one more thing to forget, and stopping the Lead already covers "don't touch anything".
- **The owner keeps reviewing and merging every pull request.** Rejected: on 24 October four of the day's pull
  requests needed fixing, and finding that took a careful read the owner can't give from a phone. Pull requests
  waited overnight for a tap that added no review.
- **The builder reviews its own branch.** Rejected as the only review: a fresh session doesn't share the builder's
  blind spots. A builder checking its own branch before it opens the pull request is a separate idea (#684).
- **A reviewer that fixes what it finds.** Rejected: one session would both judge and change the code, and the
  builder, who knows the change, would learn nothing. The reviewer only reports and proves.
- **Unlimited fixing rounds.** Rejected: a builder and reviewer that disagree three times need the owner, not a
  fourth round.
- **Merging the owner's own sessions' pull requests too.** Rejected: the owner started those and is there for them,
  so the merge stays theirs.

## Consequences

- **Fewer pull requests wait on the owner,** and those that do come with their findings and both sides written out.
- **A review costs a slot and model time.** With 2 slots, a reviewer running means one fewer builder; the Lead's
  throughput drops while its pull requests are better read.
- **Merging is the worker's, not a builder's.** A builder still can't merge (ADR 0038: merging asks); the Lead
  merges, through the same green-check rule as every merge (ADR 0033).
- **Ready for review and Merged change meaning** on the Builders board: the review is the reviewer's, and Merged is
  the Lead's merge. Whether Merge in order stays, for what's handed to the owner, is the merging slice's call (#738).
- **The board check still applies.** A pull request that changes what the owner sees still lists every difference
  from its board, and a listed difference still needs the owner's OK before it merges; whoever merges, the Lead
  included, moves the boards on Paper as `docs/agents/process.md` says.
