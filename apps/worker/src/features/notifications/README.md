# notifications

Web push to the devices the owner turned notifications on for (#173).

**Example:** a code session needs your approval while your phone is in your pocket. It buzzes with the session's
title and "needs your approval"; a tap opens the session. Overnight, a Lead's builder asks to run
`curl https://courtyard.example/status`: "Journey book is waiting on you", with the command; a tap opens the code
workspace's Home with Journey book's row on the Builders board in view.

- **Uses:** `owner/` (each device's login), `workspaces/` (each workspace's Notify me), `context-folder/` (keeping
  it, with Undo); the sender is a dependency passed in.
- **Used by:** `worker.ts`, which hands `sessions/` its `notify`, `builders/` its `builderWaits`, `lead/` its
  `leadPaused` and `limits/` its `needs`; in the web app, `features/notifications/` and the workspace ⋯'s Notify me
  sheet (`components/sheets/notify-me-sheet.tsx`).

## API

- `GET /api/notifications` (the public key), `POST …/on` and `…/off`.
- `GET`, `POST /api/workspaces/:id/notify`: a workspace's Notify me (`NotifyMeSetting`), picked as a change ("Notify
  me: Nothing") with Undo.

## How it works

- The worker's own keys (VAPID) are made on its first run.
- Each device's subscription is kept by its device login, so a device that logs out gets no more, and one whose
  subscription has gone is forgotten.
- `sessions/` tells it of each approval asked for, each turn's end, and a PR's checks failing again after a re-run
  (#356; its `notify` option). An approval, a finished turn, a failed one and checks failing again each send one
  notification, carrying only the session's title, what it needs and the session's id.
- **The Lead and its builders** (#593, ADR 0031) send three, and nothing else: none of their sessions' own events,
  no pull request ready for review, no merge, no builder starting. Each goes once each time it happens, never again
  while it holds, and carries the page a tap opens (`page`): the code workspace's Home, a builder's at its row on the
  Builders board (`#builder-<session>`, the contract's `builderHash`).
  - "Journey book is waiting on you": the command its approval runs, or the question its turn ended on (`builders/`
    tells it as the builder comes to be Waiting on you; not for a turn a restart cut off, which carries on by itself).
  - "Journey book is Stuck": why, as its status says.
  - "The Lead paused itself": "4 pull requests wait for you", or "the usage limit until 18:10" (`lead/` tells it as
    either starts holding it back).
- **Notify me** (#493) decides which go, by the session's workspace: Everything; Only what needs me (approvals,
  failures, checks failing, a builder waiting on you or Stuck, the Lead pausing itself, usage nearing its limit, and
  a finished turn only when its answer ends asking the owner something: replies were suggested, or its last words
  end in "?"); or Nothing. Code workspaces start on Everything, planning ones on Only what needs me. After a restart,
  the one notification names only the cut-off turns of workspaces not on Nothing, and none of the Lead's builders.
- The sender is a dependency passed in: `web-push.ts`, the one real one, through the `web-push` package; `fake.ts`
  keeps what was sent for the tests and the browser tests.
