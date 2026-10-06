# The live worker runs from its own copy of main, started at log on, updated when the owner chooses

The worker used to run only when started by hand, from the development checkout: a restart of the worker machine left
Courtyard offline, and switching branches while developing changed or broke the live app. So the live worker gets its
own plain clone of `main`, separate from any development checkout and only ever on `main`. A scheduled task starts it
when the owner logs on to the worker machine, running as the owner, with no window, and restarts it if it stops. It
is updated only when the owner runs one update command, which puts back the running version if any step fails.

## Considered options

- **Run from the development checkout.** Rejected: development and the live app keep breaking each other.
- **A second worktree of the development repository.** Rejected: git won't let two worktrees check out the same
  branch, so a worktree on `main` blocks checking out `main` for development.
- **A built release (a zip per version).** Rejected for now: the worker runs its TypeScript directly and needs its
  installed packages, so a release still needs installing; more process for one owner on one machine.
- **A Windows service, at boot.** Rejected for now: the worker reaches Claude through the owner's own Claude Code
  login (ADR 0003), so a service would have to run as the owner with their password stored for it.
- **The Startup folder.** Rejected: a visible window that's easy to close, and nothing restarts it after a crash.
- **Updating automatically when `main` changes.** Rejected: the live app could restart under the owner mid-session.

## Consequences

- **Scripts in the repository** (`scripts/live/`) set up the task once and do every update, so the setup is written
  down and repeatable. They hold no personal paths: the live copy's settings stay in its own `.env`, which git ignores.
- **An update** refuses when the live copy has changes of its own or `main` is failing CI, then pulls, installs the
  locked package versions and builds. If any step fails it restores the previous version, so a broken build never
  replaces a working app. It then restarts the task and waits for the health check to answer.
- **A restart interrupts a running turn,** which the event log already records as interrupted (ADR 0006). The update
  says so before it starts.
- **The update can run without a window and writes its result to the data folder,** so the next step, an Update
  button in the app with a notice when a newer version is on `main`, can start it and report how it went. The button
  is the owner's action, not a model's.
- **Phase 6 revisits the start.** Waking the worker machine remotely makes starting before anyone logs on matter;
  the task's trigger changes then.
