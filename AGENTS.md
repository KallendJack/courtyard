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
- **One seam inside the worker: the provider.** Claude, Codex and the scripted fake sit behind it. Add another seam only
  when two real implementations exist. Side effects that tests must observe (sending a notification, the clock) are
  passed in as dependencies.
- **Only the Claude adapter knows how Claude is billed or signed in** (ADR 0003). The same holds for Codex.
- **Everything a model is told follows `docs/ai-conduct.md`.** Read it before changing any model-facing text.
- **The web app's look comes from one theme**, in `apps/web/src/styles.css`: Moorland by day (the Paper design
  chosen in issue #2) and Handheld by night (the Paper boards "Handheld ·"). Colours, fonts and radii are used by
  name, never by value. Components join classes with
  `lib/classes.ts`, which merges nothing, so no class-merging code reaches the first load.
- **Shared pieces, never hand-styled copies** (ADR 0012). `components/` holds Courtyard's shared pieces: buttons, icon
  buttons, text fields and error lines come from there, on every page, and are safe on the first load. Pages and
  feature folders (`sessions/`) never style a raw `<button>`, `<input>` or error line themselves: when a shared piece
  doesn't fit, give it an option or add a shared piece. Anything used twice becomes a shared piece; until then a
  control that is the only one of its kind lives inside the one shared piece that uses it (the composer's message
  box).
- **Workspaces differ by their data, never by their code.** A workspace's page is built from general blocks (Things,
  documents, plans, rich blocks) that fill themselves from that workspace's own context; no screen, card or branch of
  code is made for one workspace (its name, its kind of hobby). A new kind of view is a new general block any
  workspace can use.
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

- **Design in Paper first.** Anything that adds or changes what the owner sees gets a Paper design the owner has
  agreed before it's built: the ticket links its Paper board before it's `ready-for-agent`, and one without a board
  stops for a design first. A change with nothing new to see (a title updating in place, say) needs none.
- The owner reviews every PR on GitHub. Check a PR's state before pushing more commits to it.
- A PR that adds a module, changes how the parts connect, or changes what's in a workspace folder updates
  `docs/architecture.md`.
- A PR that changes how Courtyard is installed, set up, run or recovered updates `README.md`.
- The order of work is the GitHub milestones: `docs/agents/roadmap.md`.

## Agent skills

### Issue tracker

GitHub Issues on this repo, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels, unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.
