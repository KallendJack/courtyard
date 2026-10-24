# Code sessions work on a session branch in its own worktree, with a command allowlist

In a code workspace, each session gets its own session branch, checked out in its own git worktree in the worker's
data folder. File edits inside that worktree apply without asking; commands on the workspace's command allowlist run
without asking; anything else pauses the turn for an approval that shows the exact command. At the end the owner
reviews the branch's diff and merges or discards it. Git is the safety net: nothing reaches the owner's branches
unreviewed, and the owner's own checkout of the repository is never touched while a session runs.

A worktree per session, not just a branch, because one folder can only have one branch checked out: two sessions in
one repository, or the owner working in it at the same time, would otherwise collide.

## Considered options

- **Approve every edit and command.** Rejected: unusable from a phone, and defeats the point of an agent.
- **A throwaway container per session.** Deferred: the cleanest isolation, but too much setup for now.

## Consequences

- An allowlisted command matches exactly; anything that could chain a second command (`;`, `&&`, `|`, substitution)
  is never allowlisted.
- Merging refuses, and says why, when it would conflict or when the owner's checkout has uncommitted changes.
- Only a provider that can code may be used in a code workspace.
- A worktree goes once its session's pull request is merged or closed. (Amended 2026-10-24, #605.) One whose session
  never opens a pull request (a grill, a question, a stopped builder) would otherwise stay, with its package install,
  for ever: after 3 quiet days with no pull request (no turn, event or commit), it's cleared too, unless the session is
  mid-turn, waits on the owner, has a task running or works on a branch it didn't make. What GitHub lacks goes first:
  uncommitted changes are committed and the branch pushed as `wip/<session branch>`, so nothing is lost. The session's
  next turn checks the branch out again from there, and deletes the `wip/` branch. What GitHub has is asked of it,
  and anything the `wip` branch couldn't keep keeps the worktree: GitHub unreachable, a failed commit or push, the
  worktree on another branch, a helper's work not on the branch, or new files that look like secrets.
