# The context folder's backup is a git repository in a shared folder on the NAS

ADR 0009 put the context folder's main copy on the owner's NAS, reached over SSH. But the owner's NAS has no git, and
its SSH switches itself off after a few hours, so a push over SSH would fail most of the time. Git can push to a bare
repository in any folder it can write to, so the backup is a bare repository in a shared folder on the NAS (SMB),
signed in to once on the worker machine. Nothing personal leaves the house, nothing runs on the NAS, and its own
backups cover the folder.

## Considered options

- **A git server on the NAS (Forgejo).** Rejected for now: another service to keep updated, for a history the
  workspace page already shows.
- **A private repository on a hosted git service.** Rejected: the owner's life context would leave the house, which is
  what ADR 0009 chose against.

## Consequences

- **The remote is still only a setting,** so moving to a git server later changes one line of the worker's settings.
- **The worker sets up its own repository.** It makes the context folder a git repository the first time it starts,
  committing whatever is there. Without a remote set, changes still save and commit, and the home page says the
  context isn't backed up.
- **A failed push** is retried after the next change and every ten minutes, and the home page says how long the backup
  has been behind, and why, until a push succeeds.
- **Hand edits are committed** as their own change before the worker's next one, so Recent changes and Undo stay right.
