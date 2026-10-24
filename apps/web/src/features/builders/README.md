# builders

The Builders board (#592, [ADR 0031](../../../../../docs/adr/0031-the-lead-keeps-each-builders-status-and-every-wait-ends-on-its-own.md);
Paper, "Tablet · Builders board, running", "Tablet · Builders board, waits on you, Stuck, limit", "Cover · Builders
board, running"): everything the Lead and its builders are doing, in one place and one set of words, at the top of a
code workspace's Home.

**Example:** the header says "2 of 2 building · 1 of 4 for review" and, under it, "Runs all night · Sub-workspaces
starts when a place frees", with Pause. Ideas, ranked by value is "Building · 6 min", editing ideas-card.tsx; Journey
book is "Checking · 2 min", history.test.ts 2nd in line; Notify me is "Ready for review · 20 min" with Review.

- **Uses:** the contract (`LeadStatus`, `BuilderStatus`, `LeadHolding`), `features/code-home/` (`api.ts`'s Lead
  calls, `merge-in-order.ts`), `features/sessions/` (answering an approval), `components/layout/home-block.tsx`,
  `components/buttons/`. The worker's side is [`builders/`](../../../../worker/src/features/builders/README.md) and
  [`lead/`](../../../../worker/src/features/lead/README.md).
- **Used by:** `features/code-home/` (the board, in Running's and the Lead's row's place), `features/home/` (each
  code workspace's tile line, and Allow and Retry in Home's Needs you), `features/waiting/` (a builder's words).

## Screens

- **The header:** how many build of how many may, and how many pull requests wait for review of the 4 that hold the
  Lead back; under it every reason it starts no more, never only the first ("Not starting more: the usage limit,
  until 18:10 · Pin to Home waits for Journey book to merge"), or what it starts next; paused, that builders carry on.
  With nothing building or for review it has no counts; paused with no builders, nothing runs, so its one quiet line
  says "Not running · Run starts the next issue" (#646). Pause while it runs, Run while it's paused or resting, and
  Merge in order once more than one is ready.
- **A row per builder** (`builders-board.tsx`): its issue's name, one of the eight statuses and since when, and what
  it's doing now (what its model does, the check and its place in line, what it asks, when it carries on, why it's
  stuck). A button only when it acts: **Allow** (an approval) or **Answer** (a question, in its session) while
  Waiting on you, in gold; **Review** while Ready for review, in moss; **Retry** while Stuck, in red. A row that's only
  working (Building, Checking, In CI, Waiting for the limit) has a quiet › and opens its session. A merged one leaves
  at the end of the day.
- **From a notification** (#593): a builder's opens Home at `#builder-<session>` (the contract's `builderHash`),
  and its row is scrolled into view, inside the board and the page.
- It keeps its size whatever it holds (#283): from a tablet up four shares of the column's height to Needs you's one (never less than its label and a row there; on the Fold open, three builder rows fit whole, #690),
  on a phone three rows tall, its rows scrolling inside. With nothing running (never run, or paused with no builders),
  it is the same in every workspace (#648): Run, and one quiet line, "Not running · Run starts the next issue". The
  first Run shows what the Lead does, in a dialog, before it starts; after that Run starts it straight away.

## How it works

- `words.ts` (no React, no styles): the eight statuses' names, how long each has lasted, what a builder is doing now,
  and the header's lines, so the board, Home's Needs you and the tiles say the same.
- `api.ts`: each workspace's Lead as last known (`useLead`, kept for the tab's lifetime and fresh the shared way,
  faster while a builder is at work), which the board and Home's tiles share; and Retry.
- `builder-actions.tsx`: Allow and Retry, a pill on the board, words in Home's Needs you.
- Nothing here decides what waits on the owner: the statuses are the worker's (`builders/`), and on a code
  workspace's Home Needs you leaves a builder's needs to the board (`code-home/needs.ts`, `onTheBoard`).
