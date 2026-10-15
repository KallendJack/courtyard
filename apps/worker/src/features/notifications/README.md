# notifications

Web push to the devices the owner turned notifications on for (#173).

**Example:** a code session needs your approval while your phone is in your pocket. It buzzes with the session's
title and "needs your approval"; a tap opens the session.

- **Uses:** `owner/` (each device's login); the sender is a dependency passed in.
- **Used by:** `worker.ts`, which hands `sessions/` its `notify`; in the web app, `features/notifications/`.

## API

- `GET /api/notifications` (the public key), `POST …/on` and `…/off`.

## How it works

- The worker's own keys (VAPID) are made on its first run.
- Each device's subscription is kept by its device login, so a device that logs out gets no more, and one whose
  subscription has gone is forgotten.
- `sessions/` tells it of each approval asked for, each turn's end, and a PR's checks failing again after a re-run
  (#356; its `notify` option). An approval, a finished turn, a failed one and checks failing again each send one
  notification, carrying only the session's title, what it needs and the session's id.
- The sender is a dependency passed in: `web-push.ts`, the one real one, through the `web-push` package; `fake.ts`
  keeps what was sent for the tests and the browser tests.
