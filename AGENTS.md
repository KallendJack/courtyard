# Courtyard

A self-hosted hub for planning and coding with AI models, one workspace per area of the owner's life. Two parts: a
worker that does all the work, and a web app that is static files. Its words are in `GLOSSARY.md`, used in code,
tests, UI text and commits. What is being built is in the spec issues on GitHub (`docs/spec.md` is the original spec,
frozen on 2026-10-08); why it is built that way is in `docs/adr/`. Before deciding where a change goes, read
`docs/architecture.md`: which part does what, and how the parts connect.

## Where code goes

- **The worker owns everything** (ADR 0001): the context folder, sessions, providers, the owner's login. The web app
  renders and calls the worker's API; it holds no state and does no model work.
- **One contract.** Everything that crosses between web app and worker is a Zod schema in the shared contract package,
  with types inferred from it. Nowhere else defines those shapes.
- **What waits on the owner (a new reply, an approval, a failing check, a PR to merge) is decided once, in the
  worker,** and every screen reads it; no screen works it out itself.
- **One seam inside the worker: the provider.** Claude, Codex and the scripted fake sit behind it. Add another seam only
  when two real implementations exist. Side effects that tests must observe (sending a notification, the clock) are
  passed in as dependencies.
- **Only the Claude adapter knows how Claude is billed or signed in** (ADR 0003). The same holds for Codex.
- **Everything a model is told follows `docs/ai-conduct.md`.** Read it before changing any model-facing text.
- **The web app's look comes from one theme**, in `apps/web/src/styles.css`: Handheld (the Paper boards
  "Handheld ·"), dark whatever the device's setting (#210). There is no light theme, so nothing uses `dark:`.
  Colours, type sizes, radii and effects are used by name, never by value; `scripts/theme/check.ts` fails
  `pnpm verify` on one by value (one-offs, with a reason, in its `allowed.json`). Each colour means one thing:
  violet is open, live or chosen; gold is something that needs the owner; moss is passed or connected; red is
  failed. Components join classes with `lib/classes.ts`, which merges nothing, so no class-merging code reaches the
  first load.
- **Nothing jumps in: a block that loads after its page uses the shared loading piece** (`components/kept.tsx`,
  #269): the last answer at once on a revisit, faint rows in its place the first time, never a spinner.
- **Shared pieces, never hand-styled copies** (ADR 0012). `components/` holds Courtyard's shared pieces: buttons, icon
  buttons, text fields and error lines come from there, on every page, and are safe on the first load. Pages and
  feature folders (`sessions/`) never style a raw `<button>`, `<input>` or error line themselves: when a shared piece
  doesn't fit, give it an option or add a shared piece. Anything used twice becomes a shared piece; until then a
  control that is the only one of its kind lives inside the one shared piece that uses it (the composer's message
  box).
- **Workspaces differ by their data, never by their code.** A workspace's page is built from general blocks (Things,
  documents, plans, rich blocks) that fill themselves from that workspace's own context; no screen, card or branch of
  code is made for one workspace (its name, its kind of hobby). A new kind of view is a new general block any
  workspace can use. The test, in designs and in code: before adding a block, name three unrelated workspaces that
  would use it. If you can't, it isn't a new block; it's that workspace's data in an existing one (a tyre pressure is
  a value on a pin, a lift's weight week by week is a chart).
- **Reuse before writing, in the worker too.** Request bodies go through `readBody` (`http.ts`), files through
  `files.ts`, workspace errors through one handler, and tests through `testing.ts`. Check there before writing a
  helper; if one is missing, add it there.

## TypeScript

- Strict, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. No `any`, and no `as` or `!` to quiet the
  compiler: fix the type or parse the value.
- Zod at every edge: HTTP, disk, environment, and every model or SDK response.
- Branded ids. Anything with variants is a discriminated union. No enums.
- Errors are values at module interfaces (`Result`); throw only for bugs.
- `type` over `interface`. Options object once a function takes more than two parameters.

## Tests

Three places only (see the spec's testing decisions): the worker's API in-process, the provider seam, and Playwright
against a real worker running the fake provider. Test behaviour through those; never import a module's internals.
Real temporary folders and real git, not mocks of them. Write the failing test first when fixing a bug.

Before pushing, run `pnpm check`, `pnpm typecheck`, `pnpm test` and the e2e specs for what you changed
(`pnpm exec playwright test e2e/<spec>.spec.ts`); the full e2e suite runs in CI on every PR, across four shards, so
don't run it locally (it takes about 8 minutes of the machine's one build turn). `pnpm verify` stays for a full local
run when you need one.

## Safety

This repo is public, and the app runs models that can change files on a real machine, so for every change:

- **Nothing personal in the repo.** Hostnames, addresses, paths and secrets come from the worker's settings. Code,
  tests, fixtures and docs use placeholders such as `courtyard.example` and `/path/to/repo`. The owner's context folder
  is never inside this repo.
- **A workspace is a boundary.** A session sees only its own workspace folder (and, in a code workspace, its session
  branch's worktree) and only the tool connections that workspace names. Nothing from the worker machine's own Claude
  Code setup leaks in (ADR 0003).
- **Anything that changes things outside a session branch needs an approval** (ADRs 0007, 0008). The one exception
  is a save to context, which the worker checks and writes, and the owner can undo (ADR 0013).
- **Credentials never reach the browser, the event log or the context folder.**

## Process

The process is Matt Pocock's skills (below), as they are. On top of them:

- **Every project's Paper file has four pages** (#340): `1 · Live` (one board per screen per device, as built, plus
  the style guide and components), `2 · Agreed` (OK'd, not built), `3 · Drafts`, `4 · Archive`. Names, layout and
  how boards move: `docs/ai-conduct.md`, Paper. A PR that changes what the owner sees lists its boards in its
  description ("Boards: Tablet · Home → Live, replaces …"), and whoever merges it moves them.
- **Design in Paper first.** Anything that adds or changes what the owner sees gets a Paper design the owner has
  agreed before it's built: the ticket links its Paper board before it's `ready-for-agent`, and one without a board
  stops for a design first. A change with nothing new to see (a title updating in place, say) needs none; a ticket
  that says it needs no new design names the agreed board that already covers it.
- **A screen shows only what the owner needs right now; the rest is one tap away.** A planning workspace stays
  calm: a thing shows what it is (its name and kind), never a warning or a "needs doing" nudge. A code workspace
  shows what waits on the owner: an approval, a failing check, a new reply, a PR ready to merge.
- **Tap or talk; typing is the fallback.** Wherever Courtyard can know or guess a value (a repo's name, a photo's
  contents, what was just said), it fills it in and the owner taps to pick or confirms; any field can also be spoken.
  Before acting, show everything it filled in, all of it, so one tap does exactly what the owner sees. A text box is
  for words only the owner has, and opening a page never opens the keyboard on touch.
- The owner reviews every PR on GitHub. Check a PR's state before pushing more commits to it.
- A PR that adds a module, changes how the parts connect, or changes what's in a workspace folder updates
  `docs/architecture.md`.
- A PR that changes how Courtyard is installed, set up, run or recovered updates `README.md`.
- The order of work is the GitHub milestones: `docs/agents/roadmap.md`. **Every issue you file goes in a milestone**
  (`gh issue create --milestone "<title>"`, `Later` when unsure) with a category and a triage label. Courtyard's own
  screens read the roadmap from them.
- **Claim an issue before building it.** Several builders work at once (Courtyard sessions and Claude Code
  helpers). Before starting, check the issue's comments and open PRs for a claim; if there is none, comment
  "Building this: <session or helper> (<branch>), <why>" first, where why is "next in order" or "the owner asked".
  "The next task" means the first `ready-for-agent` issue, in milestone order, that nobody has claimed and that
  doesn't touch the same files as a claimed one. Stopping without a PR, say so on the issue ("Stopped: <why>"); a
  claim with no pushed branch or PR after 12 hours is free.
- **Build only `ready-for-agent` issues, one per PR.** Work without an issue gets one first (milestone and labels),
  unless it's docs or CI only. Bundle issues in one PR only when the owner says so, and never add new work to an
  open PR.

## Agent skills

### Issue tracker

GitHub Issues on this repo, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels, unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.
