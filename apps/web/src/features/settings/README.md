# settings

Settings' own pieces. The worker's side is [`owner-context/`](../../../../worker/src/features/owner-context/README.md),
[`context-folder/`](../../../../worker/src/features/context-folder/README.md) (the backup) and
[`auth/owner/`](../../../../worker/src/auth/owner/README.md).

**Example:** Settings shows the backup as up to date, your owner context with its lines, and Log out other devices.

- **Uses:** `features/sessions/`, `components/workspace/context-lines.tsx`.
- **Used by:** Settings (`routes/_app/settings.tsx`), `features/home/` (the backup's state).

## Screens

Settings, behind the frame's Settings sheet:

- The backup notice (`backup-status.tsx`).
- The owner context panel (`owner-context-panel.tsx`).
- Logging out other devices (`log-out-others.tsx`).
