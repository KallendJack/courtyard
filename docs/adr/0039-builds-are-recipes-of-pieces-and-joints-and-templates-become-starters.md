# Builds are recipes of pieces and joints, composed by the model and worked out by code

Decided with the owner on 2026-10-25 and 2026-10-26 (#766, #768). Builds on ADR 0036 (Builds are worked out by
code) and ADR 0037 (Fabrication owns its records). Templates become tested starters.

ADR 0036 made a Build a template and its parameters. That holds the numbers right, but only for what a template
covers: the framed bench, and printed parts. Every new kind of build (a box, a storage rack, a stand for a printer)
would be a new template, hand-written in code, with its own parts, cut plan and steps. Printed parts already showed
the way out: a part recipe (#702) is data a model writes and code checks, and a new shape is a new recipe, never new
code. The owner's bar for every Build (#766) is "from nothing to built, easy DIY, almost like building flat pack, but
with custom timber and parts", so a Build needs to be any such thing the owner says, not only the ones a template
fits.

So:

- **A Build is a recipe:** the pieces it's made of, grouped, and the joints that hold them, every size sourced (ADR
  0037). The model writes only the recipe. Code checks it and derives everything else from it: the parts, the cut
  plan, the buy list, the build steps, their close-ups, and the checks (sag, tipping, racking, fixings long enough,
  #771). The model still never writes a length, a quantity or a total itself.
- **Version 1's vocabulary is small,** and a recipe uses only it:
  - **Pieces:** a timber member, a sheet panel, a printed part (its part recipe, #702).
  - **Groups:** a rectangle frame, a box or carcass, legs, a shelf on rails or cleats, a brace.
  - **Joints:** screws timber into timber (staggered); screws through a sheet into an edge; an angle bracket; a bolt,
    nut and washer; a printed holder or bracket.
- **Out of version 1:** pocket holes, dowels, glue-only joints, hinges, drawers and furniture. Each needs jigs, skill
  or tolerances a beginner's first builds don't have, and code can't yet check or draw them. Wall fixings and the
  French cleat come later (#767): nothing goes on a wall for now.
- **A refusal offers the nearest practical build.** Asked for drawers, the model says plainly they're out, and offers
  what the vocabulary can make instead, such as a shelf unit holding storage boxes, never a bare no.
- **Templates become starters.** A starter is a tested recipe a model starts from and changes, such as the bench, a
  box or crate, a freestanding storage rack, or a stand for a printer or tools. The bench template stays until its
  recipe gives exactly its numbers (#769); then it's a starter that loads that recipe.
- **A load is said in plain words** ("paint tins", "a 3D printer") and code turns it into a load class, set
  conservatively from a sourced table (#771), which its checks use. The model never states what a shelf can hold.

## Considered options

- **Keep adding templates.** Rejected: each new kind of build is new code, with its own steps and checks, and the
  owner asks for builds faster than templates can be written.
- **Let the model write the parts list, and code check it.** Rejected: that's ADR 0036's cut lists in prose again,
  with a check after. The recipe says what's joined to what; the parts and their numbers come from code.
- **A wider vocabulary from the start** (pocket holes, dowels, hinges, drawers). Rejected for version 1: each joint
  is a close-up, a check and a step to get right, and the owner's builds so far need none of them. A joint is added
  when a real build needs it.

## Consequences

- **`packages/fabrication` gains the recipe language,** checked by Zod in the contract and bounded (sizes, counts), as
  the part recipe is (#769). Its parts, cuts, buy list, checks, steps and pictures work from any recipe (#770–#773).
- **The bench's golden numbers are the proof:** its recipe must give exactly the template's parts, cut plan, buy list,
  findings and steps before the template goes.
- **Composing by talking** (#774) shows what the model guessed before anything is saved, and the eval scenarios check
  the saved recipe: a shelf unit from a sentence with its guesses listed, a change by talking, an over-long shelf
  getting a centre support, drawers declined with an alternative.
