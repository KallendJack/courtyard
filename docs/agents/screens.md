# Screens

Read before building or changing anything a person sees.

## Design

- Each screen is built from a board the owner agreed in the repo's Paper file, linked from its issue. Its pages are
  `1 · Live`, `2 · Agreed`, `3 · Drafts`, `4 · Archive`; a pull request lists the boards it moves.

## Look

- **One theme of tokens.** Colours, type sizes, spacing and radii are tokens named by meaning (brand, danger, muted),
  and every style uses them by name. One global stylesheet holds the base styles; the rest is styled through the
  project's styling system, picked with its stack.
- **Shared pieces.** Buttons, inputs, fields and error lines come from `components/`; when one doesn't fit, give it
  an option.
- **With Tailwind:** the tokens live in `@theme`; shared components may start from shadcn/ui, copied in and themed
  with the tokens.

## Behaviour

- A screen shows what the user needs now and what they must act on (errors, flagged items); the rest is one tap
  away. Calm: no nags.
- Zero layout shift: what loads later holds its final size from the first frame.
- Content that loads after the page fills skeleton rows, and a revisit shows the last answer at once. A button
  shows when it's busy.
- Forms keep what was typed on an error and show the error beside its field.

## Access

- WCAG 2.2 AA: contrast, a visible focus ring, labels, real buttons and links. Every screen works at 390 wide and
  by keyboard.
- Each Playwright spec runs axe (`@axe-core/playwright`) on the pages it visits.
