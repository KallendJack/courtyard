# owner

The owner's password, each device login, and slowing down wrong guesses.

**Example:** you log in on a new tablet. It gets a device login of its own; Log out other devices in Settings ends
every one but this.

- **Uses:** the data folder, through `lib/`.
- **Used by:** `worker.ts` (the login check every other request goes through), `notifications/` (each device's
  subscription); in the web app, `features/login/` and `features/settings/`.

## API

- `GET /api/auth`, `POST /api/setup`, `POST /api/login`, `POST /api/logout`, `POST /api/logout-others`.

## How it works

- Keeps its files in the data folder: `owner.json`, `device-logins.json` (only the hash of each secret) and
  `failed-logins.json`.
