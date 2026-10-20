# fresh-start

Clears the context folder and sets every session aside.

**Example:** you tap Fresh start in Settings. Every workspace's files go in one change (still in the history and the
backup), and the sessions move to `fresh-starts/<date>/`.

- **Uses:** `context-folder/`, `sessions/`, `workspaces/`.
- **Used by:** `worker.ts`; in the web app, `features/fresh-start/`.

## API

- `GET /api/fresh-start` (what it would clear) and `POST` the same.

## How it works

- It keeps the owner's password and device logins, the sign-ins and the usage limits
  ([Where things live](../../../../../docs/architecture.md#where-things-live)).
