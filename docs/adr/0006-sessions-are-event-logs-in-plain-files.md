# Sessions are worker-side event logs in plain files

A coding turn can run for minutes and the owner moves between devices, so a session is not tied to a browser tab. The
worker runs every turn to completion on its own and records the session as an append-only event log. Any device
subscribes from a position in that log, replays what it missed and follows live (server-sent events, resuming from
the last event id). An event becomes visible to subscribers only once it is on disk.

Sessions are stored as plain files, one folder per session, in the worker's data folder. No database: the install
stays "point it at two folders", and the owner's history stays readable without Courtyard.

## Consequences

- The API is job-shaped (create a session, send a message, subscribe from a position, answer an approval, stop a
  turn), not request and response.
- A turn that was running when the worker stopped is recorded as interrupted the next time its session is loaded.
- Session history lives on the worker machine, not in the context folder, so sessions are not pushed to the
  context folder's remote.
