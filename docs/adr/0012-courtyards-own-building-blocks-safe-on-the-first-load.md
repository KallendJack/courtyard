# Courtyard's own building blocks, safe on the first load, used everywhere

The web app's buttons, inputs and error lines were meant to come from the theme's shared pieces: shadcn's `Button`
and `Input`, wrapped as `PillButton`. But both join classes with shadcn's class-merging code, which the first load
(the home page and sidebar) leaves out to stay inside its budget. So every first-load button was written by hand, and
the themed `Input` was patched with the same classes wherever it was used. By ticket 17 there were six hand-built pill
buttons, five slightly different icon buttons, seven copies of the error line and three patched inputs: changing how
a button looks meant finding every copy.

So Courtyard has its own small set of building blocks in `components/`: a `Button` (its variants and sizes), an
`IconButton`, a `TextField` (label, input and error together) and a `FormError` line. They join classes with
`lib/classes.ts`, so they're safe on the first load, and every page uses them, on the first load or not. A look
changes in one place.

## Considered options

- **shadcn's `Button` and `Input` everywhere, first load included.** Rejected: about 13 KB more on the first load,
  so the budget would have to rise and the app would open more slowly on a phone, for code that only merges classes.
- **shadcn's pieces on most pages, light copies on the first load.** Rejected: that's two of everything, which is
  what drifted.

## Consequences

- **No hand-styled controls.** Pages and feature folders don't style a raw `<button>`, `<input>` or error line
  themselves. When a shared piece doesn't fit, it gets an option or a new shared piece does; a pattern used twice
  becomes one.
- **shadcn's `Button` and `Input` go.** `components/ui/` stays for shadcn components Courtyard has no piece of its own
  for (a dialog, say), added when one is needed.
- **Courtyard's pieces don't get shadcn's updates.** They're small and follow the Moorland theme, so that's cheap.
- **The standards review checks for it,** since AGENTS.md says so.
