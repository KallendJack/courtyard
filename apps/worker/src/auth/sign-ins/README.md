# sign-ins

Signing in to the providers whose sign-in Courtyard handles (Codex), and remembering the owner's Not now.

**Example:** Settings says Codex isn't signed in. You tap Sign in, follow its link, and Codex's models show in the
pickers.

- **Uses:** `providers/` (each provider's sign-in).
- **Used by:** `worker.ts`; in the web app, `features/sign-ins/`.

## API

- `GET /api/sign-ins`; `POST /api/sign-ins/:provider/start`, `…/cancel`, `…/sign-out` and `…/not-now`.

## How it works

- Not now is kept in the data folder's `sign-ins.json`; Codex's own sign-in is in its Codex home (ADR 0015).
