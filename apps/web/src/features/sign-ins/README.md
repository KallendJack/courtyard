# sign-ins

Settings' sign-in box and Connections. The worker's side is
[`auth/sign-ins/`](../../../../worker/src/auth/sign-ins/README.md) and
[`integrations/github/`](../../../../worker/src/integrations/github/README.md).

**Example:** Connections shows Claude ready, Codex not signed in, and GitHub with its account and repos, Switch and
Sign out.

- **Uses:** `components/code/connection-card.tsx`, `components/layout/kept.tsx`.
- **Used by:** Settings (`routes/_app/settings.tsx`).

## Screens

- The sign-in box, and Connections: each provider, and GitHub with its device code, account and repos, Switch and
  Sign out (`sign-ins.tsx`, with its calls in `api.ts`); one lazy load.

## How it works

- Where they stand is kept for the tab's lifetime, and until it's first known Connections keeps its place with faint
  rows.
