# limits

Remembers each provider's usage limit until its reset time, and keeps each provider's plan usage at a glance (#66).

**Example:** Claude says you're at your limit until 6 pm. Until then its models show "resets at 18:00" in the
pickers, and a new session goes to the first model with room. Before that, once Claude's week passes 80%, the
Model sheet's meter turns gold and a session on Claude warns, with Switch to Codex.

- **Uses:** `providers/` (it wraps every one, and reads each one's usage), `waiting/` (which decides the warning) and
  `notifications/` (through `worker.ts`).
- **Used by:** `worker.ts`, which hands the wrapped providers to everything else, and `sessions/`, which tells it
  what each turn heard and when each turn ended.

## API

- The limits show on `GET /api/providers`' models.
- `GET /api/usage`: each provider's plan meters and the warnings (`UsageList`); with `?read=1` (the Model sheet,
  open), read afresh first.
- `POST /api/usage/not-now`: puts a provider's warning off (`UsageNotNow`).

## How it works

- **Limits** (`index.ts`): it wraps every provider, so a turn that fails as rate-limited is remembered until its
  reset, and shows on that provider's models. Kept only in the worker's memory.
- **Plan usage** (`usage.ts`): each provider's `readUsage` is asked as the worker starts, after every turn ends and
  when the Model sheet opens, at most once a minute per provider: Claude through the Agent SDK's experimental usage
  call, Codex through its rate limits, the fake from its pretend plan. As a turn runs, its provider hears its windows
  change (Claude's `rate_limit_event`, Codex's `account/rateLimits/updated`), kept at once. A reading that fails keeps
  what was heard; a window never heard, or past its reset, is "not known yet". A provider not signed in, or a sign-in
  without plan limits (an API key), has none. Kept in the worker's memory.
- **The warning** is `waiting/`'s `usageWarnings`: a provider's fullest window from 80%, with Switch to the first
  other provider connected with room (as Carry on would go).
- **Not now** puts a warning off until its window resets, or until it passes 95%, when it comes back once; kept in
  the data folder's `usage-not-now.json`, across restarts.
- **The notification:** a window a running turn hears cross 80% tells the owner once per window until it resets,
  opening that session.
