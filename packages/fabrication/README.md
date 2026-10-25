# Fabrication's engine

`@courtyard/fabrication` turns a Build's template and parameters into everything the Build shows (ADR 0036): its
parts, cut plan, buy list, steps and making-rule findings; and a printed part's recipe into a solid and the files to
print it (#702). Plain functions, importing nothing from the worker, the web app, the file system or a model, so it
could ship on its own. Its only Courtyard imports are the contract's `SourcedSize`, the value-with-source shape every
size takes, and its part recipe.

## Example

```ts
import { deriveBench, derivePrinted, makePart, to3mf } from "@courtyard/fabrication";

const derived = deriveBench(parameters); // a framed bench's parameters, as JSON
if (derived.ok) derived.value.cutPlan; // 4 lengths of B 1450 + A 750, 1 of 5 × 460…
else derived.error; // ["height.source: Invalid input…"]

const holster = derivePrinted("battery-holster")(parameters); // 84.4 × 119.2 × 70.2 mm
const recipe = holster.ok ? holster.value.print?.recipe : null; // null when it can't be made
if (recipe) {
  const made = await makePart(recipe); // its solid: size, volume, triangles
  if (made.ok) to3mf(made.value, "Battery holster"); // the bytes Bambu Studio opens
}
```

## What's in it

| File | What it does |
|---|---|
| `index.ts` | What callers import |
| `build.ts` | What a template derives: parts with a box each for the 3D view, the cut plan, the buy list, steps, findings, and a printed part's own |
| `stock.ts` | What parts are cut from and fixed with: timber, sheets, fixings and their prices. A template takes each slot's stock as a parameter, so a slot can be swapped |
| `catalog.ts` | The stock options (#704): each timber's and sheet's sizes, what it's like, and the jobs it suits, and what each is like for the slots it would fill, judged by the strictest |
| `options.ts` | A template's slots offered those options, each costed by working the Build out again with it, the stock in use as it is; a pick swapped in, keeping the old one's price and size; and the making rule that flags stock wrong for its slot |
| `cut-plan.ts` | Packing: timber pieces into lengths and sheet pieces into sheets, the kerf between every two, each sheet's first cut along it or across it, whichever needs fewer sheets |
| `buy-list.ts` | Whole lengths, sheets and packs, at the prices given; an unpriced line is counted, never guessed |
| `findings.ts` | The making rules code checks: a bolt long enough for what it passes through plus two threads, tools needed and not to hand, sizes assumed |
| `tools.ts`, `glossary.ts` | The tools and kit a step can need, and the words a beginner may not know |
| `bench/` | The first template, the framed bench: `parameters.ts`, `frame.ts` (where each piece goes), `preparing.ts` and `steps.ts` (each action in "show me how" and "just the numbers"), `close-ups.ts`, `stock-slots.ts` (its frame, wide timber, top, shelf and braces, and `pickBenchStock`), and `scenes.ts` with `scene-pieces.ts` (each step's picture, #754) |
| `print/` | Printed parts (#702): `templates.ts` (the holster, shim and bracket, each made into a part recipe, and `printed-part`, a recipe as written), `recipe.ts` (each face's frame, and the checks that refuse a recipe before it's made), `index.ts` (a printed part's Build: its part, buy list, steps and findings), `make.ts` (the solid, with manifold-3d), `lettering.ts` (text as outlines, with opentype.js), `files.ts` (3MF, zipped with fflate, and STL) |
| `print/font/` | Figtree Bold, for lettering: `figtree-bold.ttf` from Fontsource (`@fontsource/figtree` 5.2.10, latin 700), under the SIL Open Font License in `OFL.txt`, from github.com/erikdkennedy/figtree |

## The rules it keeps

- **Every size has a source** (`measured`, `specified` with its reference, or `assumed`); one without is refused. A
  size the owner chooses for a printed part (its walls) is a plain number.
- **Castors left out are none,** so a change that takes them out (a merge patch's `null`) leaves a bench on its legs.
- **A cut plan never overruns** a length or a sheet, with the kerf counted between pieces; a part bigger than its
  stock is found and left out.
- **The steps depend on the tools to hand;** the parts and the cut plan don't. A step that can be done more than one
  way lists its ways, the one in use and the others not yet to hand (a hand saw until there's a circular saw).
- **Each step says which parts it puts on the Build** (none for checking, marking and cutting), and something fitted
  (a castor) says the part it's fitted to, so the 3D view can build the Build up step by step (#699).
- **Each step has an ID** saying what it does ("fit-castors"), the same whichever steps the Build has, so the
  owner's progress stays on its step when one before it comes or goes.
- **Each step has a picture of the job as it's done** (#754): the length on the Workmate or in its jaws (on a bench
  for a circular saw), an end frame flat on the floor, a castor base upside down, or the frame as far as it's built.
  It says where it opens from (15° to 60° above level), and its marks (sizes, the pencil line, where the saw runs,
  the diagonals to check, where the support goes, the waste side) are the Build's own numbers. Tools are drawn only
  when they're to hand.
- **Marking starts by checking the end is square,** then one line per length, each with its ticks from that end and
  the kerf between pieces.
- **A fixing found too short is never fitted:** the steps and the buy list use the length to use instead, unpriced
  until it's given a price, and the finding names the steps that fit it.
- **Parts are cut to the whole mm below,** and the steps say every size to the whole mm; the Build keeps it exact.
- **A part recipe is checked before it's made:** a feature of a kind no recipe knows, a hole or slot off its face, or
  a pocket running out of the part where it isn't open is refused with a finding, and nothing is made. Holes, slots
  and pockets allow the printer's clearance (0.2 mm, assumed, until it's calibrated); a wall thinner than two lines
  of the nozzle, or a part bigger than the plate (256 mm each way until the printer's Thing says), is found. A part
  has at most 10 lines of lettering, 200 letters in all, so it makes in seconds.
- **Only one closed solid is made:** a pocket or lettering without the part under it (on a cylinder's curved side,
  or the empty part of an L-bracket's top), a part in pieces or of nothing, and a part manifold fails on are each
  refused with the reason, and no file is made.
- **A countersink goes where the hole first meets the part,** so a screw through a holster's back wall sits flush
  inside it.
- **Prices are never here.** An option's price comes from its shop's page, in the Build's `prices`, set through the
  Build tool, with the length (or sheet size) it's for when that isn't the option's own; one without a price is offered
  unpriced, and one without a shop is offered as such, never as sourced.
- **The stock in use is costed as it is,** at its own length and price, and stock that's no option is offered first,
  picked.
- **A pick changes only what it swaps:** the parts, cut plan and buy list follow the new section; its old price and
  length are kept in `prices`, so picking it again puts it back as it was.

## Tests

`cut-plan.test.ts` (packing, whatever the pieces), `bench/bench.test.ts` (the golden bench, the garage workbench's
hand-checked numbers with invented names, in `bench/fixtures/golden.ts`), `bench/scenes.test.ts` (each step's picture
for the golden bench, by the tools to hand), `print/print.test.ts` (the golden holster and shim, `print/fixtures/golden.ts`:
their size and volume worked out by hand, closed all round, the pocket allowing the clearance), `print/recipe.test.ts`
(what a recipe is refused for) and `print/make.test.ts` (what a checked recipe still can't be made into).

## Used by

The worker's `features/fabrication/` (#697), which keeps a planning workspace's Builds, works each out with it, and
makes a printed part in a thread of its own (#702); its `prompts/builds.ts`, which gives a model each template's
parameters as JSON Schema; and Fabrication (`apps/fabrication`, #698, #699), which shows all it works out, the steps
as an instruction manual, and a printed part on its plate.
