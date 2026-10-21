# limits

Usage at a glance (#66): each provider's plan meters and the warning before a limit, as the worker decides them. The
worker's side is [`limits/`](../../../../worker/src/features/limits/README.md).

**Example:** Claude's week passes 80%. In a session on Claude, a gold card above the Reply box says "Claude: 82% of
this week used · Resets Thu 09:00 · switch before it stops mid-turn", with Not now and Switch to Codex; on a code
workspace's Home, a gold Usage line above Main says the same and opens the Model sheet, where Claude's meters show
above its models.

- **Uses:** `components/` (buttons, the open row, kept answers, the dock's Model sheet), and
  `sessions/composer/limits.ts` for how a reset time reads.
- **Used by:** `routes/` (the session page's card), `features/sessions/` (the Model sheet's meters) and
  `features/code-home/` (the usage lines).

## Screens

- **The Model sheet's meters** (`plan-meters.tsx`): above each provider's models, a row per window (5-hour, This
  week) with a thin bar, % used and when it resets; violet below 80%, gold from 80%, red at 100% with "Limit
  reached"; "not known yet" for a window the worker hasn't heard of; "as of 10:42" for a reading over an hour old;
  "No plan limits for this sign-in" for one without them. A model family's own weekly limit shows under that model
  only once it's past 80%.
- **The warning above the Reply box** (`usage-warning.tsx`), for the provider the box's model is on: Not now puts it
  off on every screen until the window resets (or passes 95%); Switch changes the box's model to the other
  provider's default, so the next message goes there. No Switch when no other provider is connected with room.
- **Home's usage line** (`usage-lines.tsx`): nothing while there's room; from 80%, one gold row whatever the
  providers (#646), opening the Model sheet: the fullest first, in bold with when it's back ("Codex at its limit ·
  back 13:50"), then the others, quiet ("· Claude 83% this week"), cut first when the row is short.
- `api.ts` holds the calls and the one kept answer every screen shares (`useUsage`): the sheet asks the worker to read
  afresh while it's open; the others show what the worker last read. `words.ts` says it all in words.
