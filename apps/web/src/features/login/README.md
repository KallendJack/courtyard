# login

The setup and login form. The worker's side is [`auth/owner/`](../../../../worker/src/auth/owner/README.md).

**Example:** on a new device you open Courtyard, type your password once, and this device stays logged in.

- **Uses:** `components/forms/text-field.tsx`, `components/layout/courtyard-mark.tsx`.
- **Used by:** `routes/login.tsx` and `routes/setup.tsx`.

## Screens

- Setup (choosing the password, the first time) and Login, one form (`password-page.tsx`).
