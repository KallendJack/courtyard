# status-line

The status line under a workspace's name (#256): ✓ just done · ● now · ○ next, in grey with only now in violet.

**Example:** Mountain biking's header reads "✓ Shock pump · ● Lights · ○ Shoes". You tap Lights: a small card under it
says "Now · Lights · From Thursday's chat · next is Shoes", with Done, Edit and Remove. Done, and the line reads
"✓ Lights · ● Shoes" at once.

- **Uses:** the worker's `/api/workspaces/:id/status-line`; `components/workspace/status-line.tsx` (the line and its
  card), `components/layout/kept.tsx`.
- **Used by:** `features/planning-home/` and `features/code-home/` (under the name), `api/workspace-page.ts` (loaded
  with the page, so it never jumps in).

## Screens

- **The line** (Paper, "Tablet · Header with the status line", "Cover · Header with the status line"): under the
  workspace's name, above its pills. Never a date, a warning or gold.
- **An item tapped** (Paper, "Tablet · Status line: an item tapped"): its card, with Done (not on just done), Edit
  (the words in place) and Remove. A code workspace's items open nothing: its line is built from its pull requests
  and issues.
