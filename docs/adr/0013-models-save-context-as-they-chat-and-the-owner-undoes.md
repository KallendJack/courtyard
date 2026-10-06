# Models save context as they chat, and the owner undoes what's wrong

Replaces ADR 0005. Context only stays current if saving it is effortless, and ticking every suggestion before it
counted was a wait the owner would skip. So a model saves context itself, during its answer, through a save tool the
worker gives it: each save adds, changes or removes one line, names its section (Fact, Plan or Idea) and its place
(the workspace's context file, or the owner context), and is committed the moment the worker accepts it. The check
moves from before the save to just after it: each save shows as a note in the chat with Undo and Edit, and the
workspace page lists recent changes. The model still never writes a file: it asks, and the worker checks and writes.

## Considered options

- **Keep ticking (ADR 0005).** Rejected: every change waits on the owner, and slow approvals are what put them off
  other tools. The worry it answered, a plan recorded as a fact, is still covered: each save is labelled with its
  section, in plain view, one tap from Undo or Edit.
- **Ask first only for new facts and changed or removed lines.** Rejected for now: approvals some of the time are
  still approvals. It's the step to take if saving straight away lets too much wrong context in.
- **A second model call after every answer, to pick out changes.** Rejected: two calls per turn eat into the usage
  limit the owner already runs out of, and the model answering knows best what just came up.
- **Only when the owner asks ("remember that").** Rejected: that isn't context keeping itself current. "Remember that"
  still works: the model uses the save tool.

## Consequences

- **The save tool is the worker's, in every planning turn.** It's the one way a model changes anything in a planning
  workspace; reading its files stays read-only. A provider without a way to offer it (none yet) just doesn't save.
- **Lines are labelled when a model reads them.** Each line of the context file and the owner context goes to the model
  with a short label (`[F3]`, `[P1]`), added by the worker and never stored. A save changes or removes a line by its
  label, so it can't change the wrong one. A save whose labels are out of date is refused.
- **The worker refuses a bad save and says why,** so the model can put it right once in the same turn: out-of-date
  labels, a line that repeats one already there, a line over the length limit, or About me facts from a code
  workspace. A refused save shows nothing to the owner.
- **The owner context saves too** (changing ADR 0010's "only when the owner edits it"). A save goes to About me when
  it's true across the owner's life or matters to more than one workspace, to How to answer me when it's a lasting
  preference, and to the workspace otherwise. A code workspace's models can save only to How to answer me, since
  that's all of it they read.
- **What gets saved is ruled in `docs/ai-conduct.md`,** and an eval set of invented conversations, run against the real
  model before any change to those rules merges, checks the rules work. Tests with the fake provider can't say whether
  a model saves the right things.
- **Undo reverses one change, never more,** and refuses when the line has changed since. Edit changes a saved line's
  wording, section or place as a change of its own. Undo also works on hand edits and on a whole Tidy.
- **The model sees what the owner did with its saves.** Saves, undos and edits appear in the conversation it reads, so
  an undone save isn't saved again.
- **Saves stand on their own.** One made before a turn is stopped or fails stays. The worker writes one change at a
  time, whichever session or device it comes from.
- **Tidying asks first.** Tidy, where a model proposes a shorter context file, rewrites many lines at once, so the owner
  sees each proposed change and unticks any they don't want before it's saved.
