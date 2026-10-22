# One house standard: a base, extras and shared configs

Decided with the owner on 2026-10-22 (#676), after the first overnight builders on two new repos (service-reminders
and trades-sites) followed the house setup's process to the letter (an issue per pull request, a board, green CI) but
wrote code Courtyard would never accept: CSS and browser code in strings, a 772-line page file, no README, no Zod at
the import. The house setup (ADR 0018, #129, #391, #642) only ever carried the process half of "any repo works like
Courtyard"; Courtyard's code rules lived in its own `AGENTS.md`, which no other repo's builder reads. "Consistency was
key", so the code half is now part of the house standard, generic enough for any repo, with extras where they apply.

So:

- **The base, for every repo:** the `## House rules` section of `AGENTS.md`, up to the next `##` heading: where
  work lives, words and decisions, branches and merging, docs, secrets, dependencies, dead code. Every change needs
  it, so it sits in the always-loaded file rather than behind a pointer. It has no HTML comment markers: Hermes, the
  agent in stacks, refuses an `AGENTS.md` that holds any (2026-10-22, #685).
- **Two extras, for the kinds of work a repo has:** `docs/agents/code.md` (app code: choosing a stack, vertical
  slices, small files, one language per file, types, errors and security, tests) and `docs/agents/screens.md`
  (anything a person sees: Paper first, Tailwind tokens, shared pieces, calm screens, zero layout shift, WCAG 2.2 AA).
  The base points at each one a repo has. A config repo such as stacks takes the base only.
- **Shared configs enforce what a check can:** `packages/house/tsconfig.house.json`, `biome.house.json` and the size
  check (`check-size.ts`: 400 lines a file, 15 source files a folder, with a ratchet for what's over today). The text
  holds only what no check can.
- **Courtyard holds the only copies** and follows them like any other repo; its `AGENTS.md` keeps only what's its own.
  The house setup writes the base, the extras that apply and the configs into every repo it sets up (#677), and the
  daily house check (#644) offers a pull request when a repo's copy differs from Courtyard's.
- **A repo's own rules add and win.** Its `AGENTS.md` says what its project needs and wins where it says more (stacks
  keeps its NAS rules, its `backlog.md` and Hermes's commits to main).
- **Concepts, not a stack.** Each rule states a concept any stack can follow (type safety, parsing at the edges,
  errors handled, behaviour tested), with how TypeScript does it. The project decides its stack, tailored to what
  it is, with the owner, and records it in its own ADR; the house configs serve the projects that pick TypeScript.

## Considered options

- **Copy Courtyard's `AGENTS.md` into every repo.** Rejected: most of it is Courtyard's own (the worker, the provider
  seam, workspaces), and a builder takes every line as an order.
- **A fixed folder layout for every repo.** Rejected by the owner: projects differ. The rules set conventions (a folder
  per feature, shared code in one place) and let the framework's own folders stand.
- **Shared configs as a published package that repos depend on.** Rejected for now: copies kept in step by the house
  check need no registry or release, and a repo can read its own copy.
- **Cognitive complexity in the Biome config.** Tried and dropped: it flagged 98 functions in Courtyard, and the size
  check already catches the drift that matters.
