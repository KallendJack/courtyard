# Every workspace also gets the owner context

Each workspace knows only its own context file, so anything true about the owner across their whole life (where they
live, units and currency, how they like answers) had to be repeated in every workspace, and the copies drifted. So the
context folder gets one more file, `OWNER.md` at its top: the owner context. It has two sections, About me (facts,
plans and ideas true across the owner's life, under the same context-line rules as a workspace's file) and How to
answer me (preferences every model follows). The worker sends it with every turn, in its own marker, before the
workspace's context file. This widens the rule "a model sees only the workspace it's in" to "…plus the owner context:
what the owner chose to share everywhere".

## Considered options

- **Repeat shared facts in each workspace.** Rejected: it's the re-explaining Courtyard exists to end, and copies drift.
- **A "shared" workspace other workspaces can read.** Rejected: it blurs the workspace boundary, and a model would have
  to go and look rather than being told.
- **Only answer preferences, no life facts.** Rejected for planning workspaces: facts like "UK, metric, £" matter to
  nearly every plan.

## Consequences

- **Text only, read-only.** The owner context reaches a model as text between `<owner_context>` markers, contained like
  the context file's. `OWNER.md` sits outside every workspace folder, so no model can open or change it; it changes only
  when the owner edits it or ticks a suggestion (ADR 0005).
- **Code workspaces get How to answer me only.** A model there edits files and commits in a repository that may be
  public, so it isn't given personal facts it could write into one. A fact a code workspace needs goes in its own context
  file. This is the choice most likely to be revisited.
- **The workspace's context file wins a clash.** It's the more specific of the two, and a model is told so. Courtyard
  doesn't detect clashes itself.
- **It stays short.** It goes with every turn in every workspace, so the app warns once it passes 2,000 characters,
  a quarter of a workspace file's threshold. Nothing is cut off.
- **Optional.** Without an `OWNER.md`, every turn is framed exactly as before.
- **Always visible.** The home page shows the owner context, and each workspace page says what of it that workspace's
  models read.
