# Context files change only through suggestions the owner ticks, sorted into facts, plans and ideas

The point of Courtyard is not re-explaining, so context files have to stay current, and they have to stay true. Models
are bad at the second: an assistant that hears about a planned home gym will later say the gym exists. So a context
file has three sections (Facts: true now; Plans: decided, not done; Ideas: being considered), a model never writes a
context file itself, and changes arrive only as suggestions when the owner asks ("remember that", or a Save to context
action). Each suggestion names its section; the owner ticks the ones that are right. The worker applies the ticked
ones, commits them to the context folder's git repository and pushes to its remote.

## Considered options

- **The owner edits context files by hand.** Rejected: from a phone, files go stale.
- **The model writes freely, like an agent's auto memory.** Rejected: it drifts and records plans as facts.
- **Suggestions at the end of every session.** Deferred: the owner asking is the strongest signal that something
  belongs; an end-of-session review can be added if things get forgotten.

## Consequences

- Planning workspaces stay read-only to models; the only writer is the worker, acting on ticks.
- Every change to a context file is a commit, so any of them can be undone.
