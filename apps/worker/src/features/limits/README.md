# limits

Remembers each provider's usage limit until its reset time.

**Example:** Claude says you're at your limit until 6 pm. Until then its models show "resets at 18:00" in the
pickers, and a new session goes to the first model with room.

- **Uses:** `providers/` (it wraps every one).
- **Used by:** `worker.ts`, which hands the wrapped providers to everything else.

## API

None of its own: the limits show on `GET /api/providers`' models.

## How it works

- It wraps every provider, so a turn that fails as rate-limited is remembered until its reset, and shows on that
  provider's models.
- Kept only in the worker's memory.
