# notifications

Web push to the devices the owner turned notifications on for (#173).

**Example:** a code session needs your approval while your phone is in your pocket. It buzzes with the session's
title and "needs your approval"; a tap opens the session.

- **Uses:** `owner/` (each device's login), `workspaces/` (each workspace's Notify me), `context-folder/` (keeping
  it, with Undo); the sender is a dependency passed in.
- **Used by:** `worker.ts`, which hands `sessions/` its `notify`, and `lead/` and `limits/` its `needs`; in the web
  app, `features/notifications/` and the workspace ⋯'s Notify me sheet (`components/sheets/notify-me-sheet.tsx`).

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
- **Notify me** (#493) decides which go, by the session's workspace: Everything; Only what needs me (approvals,
  failures, checks failing, a PR ready to merge, usage nearing its limit, and a finished turn only
  when its answer ends asking the owner something: replies were suggested, or its last words end in "?"); or
  Nothing. Code workspaces start on Everything, planning ones on Only what needs me. After a restart, the one
  notification names only the cut-off turns of workspaces not on Nothing.
- The sender is a dependency passed in: `web-push.ts`, the one real one, through the `web-push` package; `fake.ts`
  keeps what was sent for the tests and the browser tests.
