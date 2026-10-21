# projects

A planning workspace's projects (#603, ADR 0032): Home's Projects, a project's page, and Carry on. The worker's side
is [`projects/`](../../../../worker/src/features/projects/README.md).

**Example:** the Garage's Home lists "Turn the garage into an office · Next: Measure the back wall" with Carry on.
Tap its name and its page shows the goal, the Next card with Carry on, and its steps, each marked You can do this,
Needs a pro or Decided. Carry on starts a session that belongs to the project, "Carry on with Turn the garage into an
office: Measure the back wall."

- **Uses:** `components/layout/home-block.tsx` (the block and its rows), `features/sessions/` (Start, for Carry on).
- **Used by:** `features/planning-home/` (Home and the project's place), `features/sessions/` (a project save's note).

## Screens

- **Home's Projects** (`projects-block.tsx`; Paper, "Tablet · Mountain biking Home: the bike, then projects (#603)"):
  under the subject, two rows tall, each project being carried on with its next step and Carry on; with no subject,
  it fills Home.
- **A project** (`project-view.tsx`; Paper, "Tablet · Project: turn the garage into an office (#603)"): a place on
  the workspace's page, `#project/<slug>`, under its header and pills: ‹ Projects, its name and goal, Next with Carry
  on, then its other steps. The box under it starts a session that belongs to the project.

## How it works

- Home brings the projects (`PlanningHome.projects`), so a project's page opens at once from it.
- Carry on (`carry-on.ts`) starts a session with the project's name and next step as its first message and `project`
  set, then opens it. Its calls and words are in `api.ts`.
