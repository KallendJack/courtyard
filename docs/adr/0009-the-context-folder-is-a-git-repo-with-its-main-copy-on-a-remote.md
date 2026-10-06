# The context folder is a git repository, worked on locally, with its main copy on a remote

Changed by ADR 0014: the remote is a shared folder on the NAS, not SSH, and every change is a commit, not only
applied suggestions.

The worker reads the context folder constantly, so its working copy is on the worker machine's own disk. Its main copy
is a git remote the owner chooses: for the owner, a repository on their always-on NAS reached over SSH, so nothing
personal leaves the house and it is covered by the NAS's backups. Every applied suggestion is a commit, pushed after
it is made.

## Considered options

- **The folder on a network share, read live.** Rejected: slow and unreliable for a process that reads it on every
  turn, and the context disappears whenever the share does.
- **A private repository on a hosted git service.** Equally workable; the remote is a setting, so the choice is the
  owner's.

## Consequences

- A failed push does not undo or block a commit; it is retried, and shown until it succeeds.
- A later always-on worker machine clones the context folder from the same remote.
