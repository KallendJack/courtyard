# model-defaults

Keeps one default model and effort for each provider (#247), not per workspace: what a new session starts on, a
switch to that provider lands on, and Carry on after a usage limit goes to.

**Example:** Codex lists Sol first, at Low, but its default starts as Astra · High. A new session starts on
Claude's default (Opus 5.5 · High), as Claude comes first; the Model sheet's Codex chip switches the next message
to Astra · High. Pick Sonnet 5.5 · Med under More models and tap Make this the default, and Claude starts there
from then on.

- **Uses:** `providers/` (it wraps every one, after `limits/`, so it knows which models are at their limit).
- **Used by:** `worker.ts`, which hands the wrapped providers to everything else; `sessions/`, whose new sessions and
  Carry on read each provider's `default`; and `waiting/`, whose Switch goes to the other provider's default.

## API

- Each available provider on `GET /api/providers` says its `default` (`ModelDefault`): the model and effort the
  worker uses now.
- `PUT /api/providers/:id/default`: makes a model and effort that provider's default (`ModelDefault`). Refused
  for a model the provider doesn't offer now (409), or an effort the model doesn't take (400).

## How it works

- **Where they start:** each adapter's `startingDefault` (Claude's own default at High, Codex's Astra at High); a
  provider without one, such as the fake, starts on its first model at its own effort.
- **Where they're kept:** the data folder's `model-defaults.json`, by provider, once the owner makes one. Not the
  context folder: it's Courtyard's setting, not something a model knows. Courtyard never learns a default from what
  was last picked.
- **When one can't be used:** its model gone from the provider's list, or at its usage limit, the provider's default
  is its first model not at its limit, at its own effort, until it can be used again. With every model at its
  limit, the default stays as it is.
