# Process: the detail behind AGENTS.md

AGENTS.md's Process section holds the rules a builder follows every time. This holds the detail and the edge cases;
reach for it when choosing the next task, claiming, or deciding whether a change needs a Paper board.

## The house standard

The House rules section of `AGENTS.md`, `docs/agents/code.md`, `docs/agents/screens.md` and `packages/house/` are the
standard every repo Courtyard sets up follows (ADR 0035), and this repo holds the only copies. A change to them is a
change for every repo: make it here, in its own issue, and the house check offers it to the rest. A rule that holds
only for Courtyard goes in the sections of `AGENTS.md` after the block.

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

Every project's Paper file has four pages (#340): `1 · Live` (screenshots of the built app, one per screen per device,
plus the style guide and components), `2 · Agreed` (OK'd, not yet built as drawn), `3 · Drafts`, `4 · Archive`. Board
names, layout and how boards move: `docs/ai-conduct.md`, Paper.

What the owner signs off on a board is what they see. These rules cover every screen in both apps, Courtyard and
Fabrication (2026-10-26: the bench's step buttons were built from their board, its picture style wasn't, and the
board went to Live as if built).

- An issue that changes what the owner sees links its agreed board before it's `ready-for-agent`; one without a board
  stops for a design first.
- **An issue built from a board covers the whole board,** or lists exactly which parts it leaves out and the issue
  that covers each. Otherwise it isn't `ready-for-agent`.
- A change with nothing new to see (a title updating in place) needs no board. Its issue names the agreed board that
  already covers it.
- **A PR that changes what the owner sees** puts Playwright screenshots of the built screen beside each board it
  builds, at 933 × 645 and 476 × 695 (and 1440 × 900 where a desktop board exists), and lists every difference. It
  doesn't merge with an unlisted difference; a listed difference needs the owner's OK; "close enough, with a
  follow-up" is not a merge. A review checks the screenshots against the board, not only the code against the issue.
- **`1 · Live` holds screenshots of the built app only,** named "Built · <Device> · <Screen>", never a copy of a
  design. On merge, whoever merges moves each board the PR built from Agreed to Archive (as built) and puts the new
  built screenshot on Live, but only if the built screen matches the board (apart from differences the owner OK'd on
  the PR). Otherwise the board stays in Agreed and the gap is written on its issue.
- **Every label says what's happening, never what isn't:** "in the green", not "no tape".

## Reviewing use

Every couple of weeks the owner starts the Review use skill (#606, `packages/skills/review-use`) in the Courtyard code
workspace: from the session logs, each user-facing feature merged in the window (a PR with a `What's new:` line) is
**used**, **misused** or **unused**, and the builders' time is split into work and waiting. The owner ticks or changes
its keep, fix or remove for each. Unused after its
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
