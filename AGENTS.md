# Courtyard

A self-hosted hub for planning and coding with AI models, one workspace per area of the owner's life. Two parts: a
worker that does all the work, and a web app that is static files. Read `GLOSSARY.md` before naming anything, and use
its terms (and avoid its _Avoid_ lists) in code, tests, UI text and commits. What is being built is in
`docs/spec.md`; why it is built that way is in `docs/adr/`.

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
- **The web app's look comes from one theme**, Moorland, in `apps/web/src/styles.css` (the Paper design chosen in
  issue #2). Colours, fonts and radii are used by name, never by value. `components/ui/` is shadcn's generated code:
  change it by re-adding a component or through the theme (`biome.json` relaxes two rules for it). `components/` holds
  Courtyard's shared pieces; feature folders (`sessions/`) keep their own. Components on the first load join classes
  with `lib/classes.ts` rather than `cn`, which keeps the class-merging code off the first load.

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
- **Anything that changes things outside a session branch needs an approval** (ADRs 0005, 0007, 0008).
- **Credentials never reach the browser, the event log or the context folder.**

## Process

- One PR per ticket, branched from `main`. Check a PR's state before pushing more commits to it.
- The owner reviews every PR on GitHub. Write PR descriptions plain English first: what it does, how it works file by
  file, at most four new terms, how it was checked, then technical detail in a collapsed `<details>` block, then one
  explain-it-back question answerable from the plain text.
- Issues don't close themselves reliably; close a ticket once its PR is merged.

## Agent skills

These docs are set up for [mattpocock/skills](https://github.com/mattpocock/skills).

- **Issue tracker:** GitHub Issues, see `docs/agents/issue-tracker.md`.
- **Domain docs:** single context: `GLOSSARY.md` at the root (named so because `CONTEXT.md` is a product term here) and
  `docs/adr/`.
