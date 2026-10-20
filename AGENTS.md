# Courtyard

A self-hosted hub for planning and coding with AI models, one workspace per area of the owner's life. Two parts: a
worker that does all the work, and a web app that is static files. Its words are in `GLOSSARY.md`, used in code,
tests, UI text and commits. What is being built is in the spec issues on GitHub (`docs/spec.md` is the original spec,
frozen on 2026-10-08); why it is built that way is in `docs/adr/`. Before deciding where a change goes, read
`docs/overview.md` (the parts and their folders, short), then `docs/architecture.md`: which part does what, and
how the parts connect.

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
- **Every screen is a pinned header, one scrolling middle and a pinned footer** (the shared page layout,
  `components/layout/page.tsx`, #339); nothing scrolls the title or the main action away. Everything that scrolls is the
  shared `Scroller` (`components/layout/scroller.tsx`, #420): a thin thumb and a fade at its top, never a hard cut;
  `scripts/theme/check.ts` fails an `overflow-*-auto` anywhere else.
- **Nothing jumps in: a block that loads after its page uses the shared loading piece** (`components/layout/kept.tsx`,
  #269): the last answer at once on a revisit, faint rows in its place the first time, never a spinner.
- **Nothing moves once drawn** (#283, #398): what loads later holds its space from the first frame, at its final size.
  A dashboard block's size is set by the layout, never by its rows: its rows scroll inside, and empty it keeps its
  size with one quiet line. `e2e/layout-shift.spec.ts` fails a main page that shifts while it loads.
- **Every block stays fresh the shared way** (`useKept` / `useFresh` in `components/layout/kept.tsx`, #387): every 30 s
  while calm, faster while busy, paused while the tab is hidden and asked at once when it's shown. Never a timer of
  its own.
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
- **A planning feature earns its place** (ADR 0032). Before it's grilled it must take friction out of a job the owner
  really does (doing a task, choosing what to buy, carrying a project, keeping a guide), live where that job happens
  (a part, the space's plan, a project, the answer; never a new block on Home), and replace something or be too small
  to need to. Planning and code workspaces share the session engine, the frame and Talk, and differ on purpose in what
  models are told, what they keep and what Home shows.
- **Familiar folders, the same in both apps** (#453). The worker's `src` has `features/`, `providers/`, `prompts/`,
  `auth/`, `integrations/`, `config/` and `lib/`; the web app's has `features/`, `components/`, `hooks/`, `api/`,
  `routes/` and `lib/`. A feature has one name in both apps (`features/things/`). A new feature is listed in
  `docs/overview.md` and has a `README.md` (#459: what it does, one example, what it uses, what uses it, and its API
  or screens) that `docs/architecture.md` links; so do each of the worker's `auth/` and `integrations/` folders, and
  its `providers/` and `prompts/`. A folder holds at most 15 files: a bigger one is split into parts by kind
  (`components/layout/`, `features/sessions/answer/`). `scripts/folders/check.ts` fails `pnpm check` otherwise. A new
  top-level folder is the owner's call.
- **Reuse before writing, in the worker too.** Request bodies go through `readBody` (`lib/http.ts`), files
  through `lib/files.ts`, workspace errors through one handler, and tests through `test/testing.ts`. Check there before writing a
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

Before pushing, run `pnpm check`, `pnpm typecheck` and the unit test files and e2e specs for what you changed, naming
each (`pnpm -C apps/worker exec vitest run test/<file>.test.ts`, `pnpm exec playwright test e2e/<spec>.spec.ts`).
CI runs the full unit and e2e suites on every PR, across five shards, so don't run them locally: they take the
machine's one build turn for many minutes, and a Lead's builder is refused them (#589). `pnpm verify` stays for a
full local run when the owner asks for one.

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

Matt Pocock's skills, as they are, plus the rules below. The detail behind them (choosing the next task, claims,
when a change needs a board): `docs/agents/process.md`.

- **One `ready-for-agent` issue per PR**, taken in milestone order (`docs/agents/roadmap.md`). Work without an issue
  gets one first, in a milestone (`Later` when unsure) with a category and a triage label; docs or CI only needs none.
  Bundle issues only when the owner says so, and keep an open PR to the work it was opened for.
- **One feature at a time in an area.** The next feature in an area (a workspace kind, the Lead) starts once the owner
  has used the last one there, or said to skip it; a PR the owner will see says how to try it.
- **How sessions, builders and the Lead run is decided in an ADR first** (ADR 0031): no rule is added to that machinery
  for one incident without writing down how it fits the rest.
- **Removal is the default.** A feature unused after its trial, or one models keep misusing, is removed unless the
  owner keeps it; every model mistake found becomes a context-eval scenario (`docs/agents/process.md`, Reviewing use).
- **Claim before building.** With no claim in the issue's comments or open PRs, comment
  "Building this: <session or helper> (<branch>), <why>"; stopping without a PR, comment "Stopped: <why>".
- **Design in Paper first.** What the owner sees is built from a board the owner agreed, linked from its issue. A PR
  that changes what the owner sees lists its boards ("Boards: Tablet · Home → Live, replaces …").
- **A screen shows only what the owner needs right now; the rest is one tap away.** A planning workspace stays
  calm: a thing shows what it is (its name and kind), never a warning or a "needs doing" nudge. A code workspace
  shows what waits on the owner: an approval, a failing check, a new reply, a PR ready to merge.
- **Tap or talk; typing is the fallback.** Wherever Courtyard can know or guess a value (a repo's name, a photo's
  contents, what was just said), it fills it in and the owner taps to pick or confirms; any field can also be spoken.
  Before acting, show everything it filled in, so one tap does exactly what the owner sees. A text box is for words
  only the owner has, and opening a page never opens the keyboard on touch.
- **Docs move with the code.** A new module, or a change to how the parts connect or to what's in a workspace folder,
  updates `docs/architecture.md` (and `docs/overview.md` for a new feature). A change to installing, setting up,
  running or recovering Courtyard updates `README.md`.
- The owner reviews every PR on GitHub: check a PR's state before pushing more commits to it.

## Agent skills

### Issue tracker

GitHub Issues on this repo, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels, unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.
