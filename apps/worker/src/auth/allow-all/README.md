# allow-all

Whether a code session allows all for this task (#428), decided from its events with no I/O of its own.

**Example:** you turn on Allow all for 4 hours. The session's commands that it covers run without asking until then,
on every screen alike, even after a restart.

- **Uses:** nothing but the contract.
- **Used by:** `sessions/`, `lead/`.

## API

None of its own: `sessions/`' `POST /api/sessions/:id/allow-all` (for `1h`, `4h`, `12h` or `task`) and
`…/allow-all/off`.

## How it works

- On from `allow-all-started` (the owner's turning it on, or a Lead's builder started with it), which stores its end
  time.
- Off at that time, at `allow-all-ended` (Turn off), when its pull request merges or closes, or, for `task`, when a
  pull request opens.
- It's never extended while on.
- `sessions/` keeps each session's as its events are written and puts it on the session's summary (`allowingAll`),
  for its strip and its row in Running.
- What it covers is `code/`'s `allowsAll`.
