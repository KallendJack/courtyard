# live

Updating the live copy from the app (ADR 0011). The worker's side is
[`live/`](../../../../worker/src/features/live/README.md).

**Example:** the home page's foot says "New version · Fix the scroll fade", its build passing. You tap Update and
Courtyard restarts on it.

- **Uses:** `components/code/build-stages.tsx`.
- **Used by:** `features/home/` (the foot), `components/frame/` (Settings), `features/code-home/` (the Main row),
  `features/pull-requests/` (the merged PR card's Update Courtyard follows its rule).

## Screens

- The notice where Update lives (`live-update.tsx`): at the foot of the home page (main's build as a row labelled New
  version, #102) and in the Handheld frame's Settings.
- Main's build beside Update (`main-build.tsx`, #249): the newest main's title, its jobs in stages (#337, drawn by
  the shared `components/code/build-stages.tsx`: each job's dot violet running, moss passed, red failed, grey
  waiting, its time counting up; as a row, a small graph that opens the full one in a sheet), and Update, offered
  unless it has failed.
- Tapped before it has passed or while a session is mid-turn, the Update waits, and the row says what for, with Cancel
  and Update now (#186); Details, the failed job's page on GitHub, once it has failed.

## How it works

- Its hook asks again every 10 seconds while the build runs and the page is in front of the owner.
- Its own lazy load, with its calls (`api.ts`), so the live status's schemas stay off the first load.
