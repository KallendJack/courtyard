# status-line

The status line under a code workspace's name (#256): ✓ just done · ● now · ○ next, in grey with only now in violet.
A planning workspace has none (#600).

**Example:** Courtyard's header reads "✓ PR review screen · ● Steer while it answers · ○ Session slots", built from
its pull requests and issues.

- **Uses:** the worker's `/api/workspaces/:id/status-line`; `components/workspace/status-line.tsx` (the line),
  `components/layout/kept.tsx`.
- **Used by:** `features/code-home/` (under the name), `api/workspace-page.ts` (loaded with a code workspace's page,
  so it never jumps in).

## Screens

- **The line** (Paper, "Tablet · Header with the status line", "Cover · Header with the status line"): under the
  workspace's name, above its connections line. Never a date, a warning or gold. Its items open nothing: they're built
  from its pull requests and issues.
