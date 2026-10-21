# live

For the live copy only: whether `main` has moved on, updating, and how the last update went
([ADR 0011](../../../../../docs/adr/0011-the-live-worker-is-its-own-copy-of-main-started-at-log-on.md)).

**Example:** a PR merges while a session is mid-turn. You tap Update; it waits for main's build, then updates and
restarts, and the cut-off turn carries on.

- **Uses:** the update command, passed in; `github/` and `code/` for main's build and the merged pull requests'
  descriptions, `workspaces/` for where a what's-new line is tried, and the machine's builds lock for a check that's
  running, through `worker.ts`.
- **Used by:** `worker.ts`; in the web app, `features/live/`.

## API

All in `worker.ts`:

- `GET /api/live`: where the live copy stands, with main's build.
- `POST /api/live/update` (Update when ready, or Update now) and `DELETE` the same (Cancel).
- `POST /api/live/whats-new/seen` `{ pullRequest }`: a what's-new line tapped (#604); 404 when the last Update has none
  by that number.

## How it works

- **Update when ready** (#186): tapped while main's build runs, it waits, kept in the data folder
  (`live-update-waiting.json`) so a crash keeps it. A repeating job runs it once the build has passed, or drops it
  when main's build fails meanwhile. Update now runs it at once, whatever it waits for; Cancel drops it, even while
  the job is reading main's build (that look then does nothing, #586).
- **Waits for a check** (#629): once main's build has passed, it also waits while a check holds the machine's builds
  lock (`checkRunning`, from `@courtyard/builds`' `holdersOf`, through `worker.ts`), so a restart never cuts a
  25–50 minute check off; it runs once the lock is free.
- **Holds nothing back** (#621, ADR 0031): it never waits for a turn mid-way, and while it waits everything starts
  as usual (queued messages, fixing turns, task reports, the Lead's builders and its merge notes).
- **After a restart:** an update the worker starts itself leaves a note (`live-update-restart.json`), so the next
  worker continues the turns it cut off.
- **What's new** (`whats-new.ts`, #604): after an Update that brought the version running (`live-update.json`'s
  `updated`), the merge commits from its `from` to its `to` name the pull requests it brought; each one's description
  is read from GitHub once, and its line `What's new: <what> · <where>` (bold or not) kept in `whats-new.json` in the
  data folder. The live status gives the next not yet tapped, its where read as a workspace by name, Settings, or else
  Home. A tap marks it seen; the next Update's lines replace them all. With GitHub out of reach it says nothing, and
  reads them again next time.
- **Main's build** (#249), while main has moved on: CI on main's newest commit, asked of GitHub through `github/` (on
  the repository the live copy's remote names, read through `code/`) only when a page asks for the live status, at
  most every 8 seconds while it runs and once a minute otherwise; none when no one is signed in to GitHub.
