# App code

Read before writing or changing code. The house configs enforce what a check can (`tsconfig.house.json`,
`biome.house.json`, the size check); this file holds the rest.

## Stack

The house defaults; a different choice gets an ADR saying why.

- TypeScript, pnpm, Biome, Vitest, Playwright and Zod everywhere.
- Hono for servers and APIs; React with Vite and TanStack Router for web apps; Astro for static sites.

## Structure

- **Vertical slices.** Each feature is one folder: its routes or pages, its logic, its browser code, and a short
  `README.md` (what it does, one example, what it uses and what uses it, its routes or screens). A feature has one
  name everywhere: folder, routes, tests, glossary. Folders a framework fixes (`pages/`, `routes/`) stay thin and
  call into the feature's folder.
- **Shared code** sits in `components/` (UI) and `lib/` (helpers); look there before writing a helper. Share
  knowledge, not look-alikes: code that must change together becomes one; code that merely looks alike stays apart
  until a third copy appears. UI pieces are shared at their second use, so the look stays consistent.
- **The entry file is the composition root:** it wires the features together and holds no logic.
- **Small files.** Source files stay under 400 lines and folders under 15 files (tests, fixtures and generated
  files aside); split by kind as they grow. The size check is a ratchet: files already over are listed at their
  size, which may shrink and never grow.
- **One language per file.** Styles in stylesheets or classes, browser code in typed modules the build bundles,
  markup in components, SQL in parameterised queries and migration files. Browser code imports the modules it
  shares with the server.
- **Single source of truth.** What's shown, counted or due is decided in one module, and everything that needs it
  imports it.

## Types

- Fix the type or parse the value. `as const` and `satisfies` are the only casts; Biome rejects `any` and `!`.
- **Parse at every edge** with Zod and infer the type from the schema: request bodies and forms, database rows,
  files, environment, and every third-party or model response.
- Variants are discriminated unions. `type` over `interface`. Expected failures are `Result` values at module
  boundaries; `throw` is for bugs. A function takes an options object past two parameters.

## Errors and security

- Every error is handled where it can be, or reaches the app's one error handler, which logs it with its context.
- Every route that reads or changes data checks who is asking. Forms that change data are protected from
  cross-site posts. Output goes through the framework's escaping; raw HTML is only ever the app's own.
- A schema change is a new migration; applied migrations stay as they are.

## Tests

- Test behaviour through what callers touch: HTTP, the page in a browser, a module's exported functions.
- Use real databases, files and git. Fake only what's outside the app's control (third-party APIs, email, the
  clock), passed in as dependencies.
- A bug gets a failing test first.
- Comments say why.
