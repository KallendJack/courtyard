# friction

Something's off (#554): friction the owner reports from any screen, filed by a session in Courtyard's own code
workspace.

**Example:** on Home you tap Something's off and say "the backup line says Fix it, but not what's wrong". File it
starts a session in Courtyard with that, the page, the screen size, the version and the screen attached; the session
files the issue in Later and draws a fix on Drafts.

- **Uses:** `workspace-main/` (`liveRepo`), `workspaces/`, `code/` (`onGitHub`), `sessions/`, `attachments/`,
  `prompts/` (`frictionMessage`).
- **Used by:** `worker.ts`; in the web app, [`features/friction/`](../../../../web/src/features/friction/README.md).

## API

- `GET /api/friction`: where a report goes (`FrictionPlace`): the code workspace on the live copy's repository, or
  `null`, and the version the live copy runs.
- `POST /api/friction`: a `FrictionReport`, as JSON or a multipart form with the screen as its one photo; answers with
  the session filing it (201), or 409 when no code workspace is on Courtyard's own repository.

## How it works

- **Courtyard's own code workspace** is the code workspace whose repository is the live copy's on GitHub, as the Main
  row decides which one offers Update. A worker that isn't a live copy has none, so it files nowhere.
- **The session** is placeless and claims nothing, as a grill is (it builds nothing), titled "Something's off: <what
  was said>". Its first message is the worker's (docs/ai-conduct.md, Coding).
