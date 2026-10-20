# Process: the detail behind AGENTS.md

AGENTS.md's Process section holds the rules a builder follows every time. This holds the detail and the edge cases;
reach for it when choosing the next task, claiming, or deciding whether a change needs a Paper board.

## Choosing the next task

"The next task" is the first `ready-for-agent` issue, in milestone order (`roadmap.md`), that:

- nobody has claimed (no "Building this" comment younger than 12 hours, no open PR for it);
- isn't blocked by an open issue (GitHub's blocked by; Next up shows it as "After …", #377);
- doesn't touch the same files as a claimed one.

Issues that edit the same files are a **family**: whoever keeps the order marks each one blocked by the one before.

## Claims

Several builders work at once (Courtyard sessions and Claude Code helpers), so a claim stops two of them building the
same issue.

- Before starting, check the issue's comments and open PRs. With no claim, comment
  "Building this: <session or helper> (<branch>), <why>", where why is "next in order" or "the owner asked".
- Stopping without a PR, comment "Stopped: <why>".
- A claim with no pushed branch or PR after 12 hours is free.
- For a Courtyard session started on an issue (Build, or a first message naming a ready one), the worker posts both
  the claim and the "Stopped" (#324). Claude Code helpers, and anything else the worker doesn't see, post their own.

## Filing

A Courtyard session's `gh issue create` without a milestone, a category label and a triage label is refused (#324);
`Later` is the milestone when unsure. Courtyard's own screens read the roadmap from the milestones.

## Paper

Every project's Paper file has four pages (#340): `1 · Live` (one board per screen per device, as built, plus the
style guide and components), `2 · Agreed` (OK'd, not built), `3 · Drafts`, `4 · Archive`. Board names, layout and how
boards move: `docs/ai-conduct.md`, Paper.

- An issue that changes what the owner sees links its agreed board before it's `ready-for-agent`; one without a board
  stops for a design first.
- A change with nothing new to see (a title updating in place) needs no board. Its issue names the agreed board that
  already covers it.
- Whoever merges a PR moves the boards its description lists.

## Reviewing use

Every couple of weeks the owner and an agent look at real use, as the builders and planning reviews of 2026-10-20 did
(the Review use skill, #606, does it once built): from the session logs, each user-facing feature merged since the last
review is **used**, **misused** or **unused**, and the builders' time is split into work and waiting. Unused after its
trial means **removed** unless the owner keeps it; a fix or a removal is filed as an issue; each model mistake found is
added to the context eval, so it can't come back unseen. Abandoned worktrees clear themselves (#605).

## Working with the owner

How any session or helper works with the owner (2026-10-20), so the project stays calm to run:

- **Ideas aren't work.** When the owner mind-maps, each idea goes, in their words, on the issue it fits or in a short
  `Later` issue (`needs-triage`), with one line saying where. Nothing is built, grilled or reordered from it until a
  review or real use asks.
- **Recommend, don't survey.** Technical calls are made and noted on the issue; only what's really the owner's (what
  they want, what it looks like, what to cut) is put to them, each with a recommendation.
- **Two lanes at most.** One spec in code and one in planning at a time; the rest of each milestone is blocked by the
  lane's last slice, so the Lead follows the lanes too.
- **One message for what needs the owner,** batched (what to merge and in what order, what to try), not a stream.
- **A finish line for each phase,** written on the pinned handoff issue, so the owner knows when to stop building and
  just use Courtyard.
