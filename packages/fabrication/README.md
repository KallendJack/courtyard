# Fabrication's engine

`@courtyard/fabrication` turns a Build's recipe (ADR 0039), or its template and parameters (ADR 0036), into
everything the Build shows: its parts, cut plan, buy list, steps and making-rule findings; and a printed part's
recipe into a solid and the files to print it (#702). Plain functions, importing nothing from the worker, the web
app, the file system or a model, so it could ship on its own. Its only Courtyard imports are the contract's
`SourcedSize`, the value-with-source shape every size takes, the stock and tools (`Timber`, `Sheet`, `Tool`…, which
`stock.ts` and `tools.ts` give by their own names), its part recipe and its Build recipe.

## Example

```ts
import { deriveBench, derivePrinted, deriveRecipe, makePart, pickRecipeStock, starterRecipe, to3mf } from "@courtyard/fabrication";

const derived = deriveBench(parameters); // a framed bench's parameters, as JSON, loaded as its recipe
const starter = starterRecipe("framed-bench", parameters); // the bench's recipe: stock, pieces, groups, joints
if (starter.ok) deriveRecipe(starter.value); // the same Build, to the last number
deriveRecipe({ ...recipe, size: { ...recipe.size, length: tooLong } }); // ["size.length: The length is 5000 mm: it must be more than 0 and at most 3000 mm."]
deriveRecipe(rack); // any recipe: a rack's parts, cut plan on its offcuts first, buy list, findings and options
pickRecipeStock(rack, { stock: "38 × 89 CLS", option: "c16-45x95" }); // the rack's recipe with C16 for its CLS
// Its steps following the owner's tools, a step started keeping the saw it was cut with (#777):
deriveBench(parameters, { tools: ["Hand saw", "Mitre saw"], kept: [{ step: "cut-timber", tool: "hand-saw" }] });
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
| `build.ts` | What a template derives: parts with a box each for the 3D view, the cut plan, the buy list, steps, findings, and a printed part's own; and what it's worked out with besides its parameters (`BuildSetting`: the owner's tools, the ways steps done were done) |
| `scene.ts` | What a step's picture is made of: its pieces and the marks drawn over them, callouts among them (#783) |
| `stock.ts` | What parts are cut from and fixed with: timber, sheets, fixings and their prices. A template takes each slot's stock as a parameter, so a slot can be swapped |
| `catalog.ts` | The stock options (#704): each timber's and sheet's sizes, what it's like, and the jobs it suits, and what each is like for the slots it would fill, judged by the strictest |
| `options.ts` | A template's slots offered those options, each costed by working the Build out again with it, the stock in use as it is; a pick swapped in, keeping the old one's price and size; the making rule that flags stock wrong for its slot; and whether stock the owner has will do for a stock (`standsInFor`, #770) |
| `cut-plan.ts` | Packing: timber pieces into lengths and sheet pieces into sheets, the kerf between every two, each sheet's first cut along it or across it, whichever needs fewer sheets, on the owner's own lengths and sheets first (spares, #770); and the lengths cut the same way, together, as they're marked |
| `close-ups/` | The close-ups by type (#813), for any Build, each drawn in 3D from the pieces it joins and their sizes (`drawing.ts` lays it flat, its pills in a column): an angle bracket in a corner (`bracket.ts`, and the brackets' plates for a 3D view), a bolt through a plate (`bolt-through.ts`, the castors' two), a screwed overlap (`overlap.ts`), measuring and marking a length with the owner's square (`measure.ts`), and driving a screw, its end zone and the drill's clutch (`driving.ts`); `techniques.ts` gives each step its techniques, in full the first time the steps use each |
| `buy-list.ts` | Whole lengths, sheets and packs, at the prices given; an unpriced line is counted, never guessed; and the tools the owner chose to buy, while they're missing, a set's missing bits by size (#763) |
| `findings.ts` | The making rules code checks: a bolt's length to use, long enough for what it passes through plus two threads, and the owner's own that are short (`boltLength`), tools needed and not to hand, sizes assumed |
| `loads.ts`, `finding.ts` | What a Build carries (#771): a load said in plain words read as a load class from a sourced table, the heaviest any word says and the heaviest when none is known (`loadClassOf`); each sheet's stiffness by its thickness, sourced, its weaker way for a layered sheet (`stiffnessOf`); and every finding a Build can have, the making rules' and the checks' |
| `capacity.ts` | What a mitre or circular saw cuts (#780): its width at 90° and depth, read from its size in Your tools, assumed until given, and whether a timber fits it |
| `tools.ts`, `glossary.ts` | The tools and kit a step can need, which of them each of Your tools, or something else the owner has, is by the words in its name, one tool or several ("Drill and drill bits", `toolsFrom`; a step stool for the long end, and only that, `standInFor`), a bit set's sizes and whether it has a bit (`bitSetsFrom`, `bitInSets`), the spanners, adjustables, socket set and pliers among them (`spannerKitFrom`, #783), and the words a beginner may not know |
| `recipe/` | A Build's recipe (ADR 0039, #769), checked by the contract's `BuildRecipe` first: `index.ts` (`deriveRecipe`: a recipe in, its Build out, or what's wrong by where it is in the recipe), `bench.ts` (the bench's recipe from its parameters, `benchRecipe`, and back, `benchFromRecipe`, only when the recipe is exactly a bench's), `starters.ts` (the starters, each a recipe from its template's parameters, and `deriveBench`, the bench template loaded as its recipe). Any recipe (#770): `layout.ts` (where every piece goes, from its groups and pieces as the words say them, the top and what's under each end), `legs.ts` (legs and their frames, a shelf on the lower rails, braces), `carcass.ts` (a box open at the front or top, its shelves on cleats), `geometry.ts` (boxes, and where two meet face to face), `fixings.ts` (each joint's fixings, counted where its pieces touch), `checks.ts` (sag, tipping, racking and screw length, #771), `printed.ts` (printed holders and brackets sized from the wood they fit, their filament, screws and steps, #773) and `work-out.ts` (`workOutRecipe`: the parts lettered, the cut plan on the owner's stock first, the buy list less what they have, the stock findings and options; `pickRecipeStock`). A bench's recipe is still worked out by the bench's code, steps and all, until any recipe's steps are (#772) |
| `bench/` | The first template and starter, the framed bench: `index.ts` (`workOutBench`, what its recipe is worked out with), `parameters.ts`, `frame.ts` (where each piece goes), `preparing.ts`, `castor-steps.ts`, `frame-steps.ts` and `steps.ts` (each action in "show me how" and "just the numbers"), `step-tools.ts` (a step's tools against the owner's: a stand-in, bits by size, #763), `screws.ts` (where a pilot hole goes first, #789), `close-ups.ts` (each step's own close-up, and the walk-throughs: marking as tape, tick, square and line, #777, and a joint's screw spots, #789; with `close-up.ts`, what a close-up is: tools and a castor drawn as their shape, words on the drawing, #783, and a type's faces and pills, #813), `castor-pictures.ts` (the castor step's picture, its drill drawn as a drill and its words as callouts, #783), `stock-slots.ts` (its frame, wide timber, top, shelf and braces, and `pickBenchStock`), and `scenes.ts` with `cut-scenes.ts` and `scene-pieces.ts` (each step's picture, #754) |
| `print/` | Printed parts (#702): `templates.ts` (the holster, shim and bracket, each made into a part recipe, and `printed-part`, a recipe as written), `recipe.ts` (each face's frame, and the checks that refuse a recipe before it's made), `index.ts` (a printed part's Build: its part, buy list, steps and findings), `make.ts` (the solid, with manifold-3d), `lettering.ts` (text as outlines, with opentype.js), `files.ts` (3MF, zipped with fflate, and STL) |
| `print/font/` | Figtree Bold, for lettering: `figtree-bold.ttf` from Fontsource (`@fontsource/figtree` 5.2.10, latin 700), under the SIL Open Font License in `OFL.txt`, from github.com/erikdkennedy/figtree |

## The rules it keeps

- **Every size has a source** (`measured`, `specified` with its reference, or `assumed`); one without is refused. A
  size the owner chooses for a printed part (its walls) is a plain number.
- **A recipe stays within its bounds** (`RECIPE_MOST`, #769): the build's length, depth and height at most 3000 mm, a
  stock's sizes at most 6000, the kerf at most 10 and an overhang at most 300; a castor's height and plate and a
  bolt's length at most 300, a bolt's thread 24 and pitch 4, a washer 10 and a nut 30 (#770); the printer's
  clearance at most 1 and its nozzle 1.2 (#773); at most 50 of a stock
  had, 16 stocks, 24 pieces, 12 groups and 32 joints. Over them, or naming two things with one ID, or pointing at what isn't there or isn't the
  right kind (a panel cut from a timber), or joining a piece to itself, it's refused with the reason, by where it is
  in the recipe. A kind it doesn't have is refused saying the kinds it has, and one out of version 1 (pocket holes,
  dowels, glue-only joints, hinges, drawers) saying what to make instead (`recipe-refusals.ts` in the contract).
- **A bench's recipe is the bench, to the last number** (#769): the bench template loads its parameters as its
  recipe, and a recipe is read back as a bench only when the bench's starter would write exactly it, whatever its
  IDs. Its parts, cut plan, buy list, findings and options worked out as any recipe's are give the template's own
  numbers (`recipe/any-recipe.test.ts`), with the checks' findings after (#771); its steps are the bench's until #772.
- **Every recipe is checked, conservatively** (#771), each finding with a plain fix: a sheet resting on supports may
  sag a 600th of its span under its load class, its sheet as stiff as its weaker way (a piece may be cut either way
  of the sheet); a build taller than 4 times its feet are apart the narrow way wants a wider base (fixing it to the
  wall is advice only), its castors measured from where they turn; legs and rails with no brace rack; a screw's
  point grips at least 6 times its diameter (EN 1995-1-1) and never comes out the far side.
- **Any recipe is worked out from what it says** (#770), nothing written per kind of build: the top on what it
  stands on, past it by its overhang; legs at the corners, long rails on their outer faces and end rails between
  them, flush with the leg tops and `lower` above their feet; or a box, its shelves on cleats spaced evenly up it; a
  shelf on the lower long rails between the end frames; braces from a frame's lower rails to the leg tops, as wide as
  the end frames; a support across the middle under a top or shelf; a base under each end, castors under that. Parts
  are lettered as they're cut (timber, then sheets; each stock's legs first, then the longest down). Each joint's
  fixings are counted where its pieces touch: two screws where a timber sits on another, a line along each timber a
  sheet rests on and each edge of the sheet pieces it's screwed to (a box's sides and back under a worktop, never
  into a face), spaced across the sheet, an angle bracket a corner (two where castors push it), bolts through
  everything they pass through, and a box's panels along every edge. A recipe that can't be placed (a joint between
  pieces that don't touch, a shelf in a box on rails) is refused with the reason.
- **A printed part in a wooden build is sized from the wood it fits** (#773): the recipe names only which part (a
  holder a timber's end drops into, or a bracket an edge runs along), the timber or sheet it fits, what it goes on and
  its screws. Code gives a holder a pocket the timber's section plus the printer's clearance each side (45.4 × 95.4 for
  45 × 95 at 0.2, assumed until the printer's calibrated), and a bracket a slot the stock's thickness plus it, so
  changing the timber resizes them. Each is a part recipe for the printed-part pipeline (#702), carried on its part
  (`print`), lettered after the parts that are cut, left out of the cut plan and out of the Build's overall size,
  and spread one to each of what it's on before doubling up; the buy list adds the filament, and their screws on
  the same line as a joint's that uses them, and the steps print them first and fit them once what they go on is
  built, with any tool they need that isn't to hand found.
- **The owner's stock first** (#770): a timber or sheet the recipe says the owner has (`have`) is bought less by
  that many, and one no piece is cut from (offcuts, at their own size) takes the pieces it will do for (the same
  option or name, section or sheet material) before any is bought, the biggest first.
- **Castors left out are none,** so a change that takes them out (a merge patch's `null`) leaves a bench on its legs.
- **A cut plan never overruns** a length or a sheet, with the kerf counted between pieces; a part bigger than its
  stock is found and left out.
- **One sheet, bought once** (#786): slots cut from the same sheet (its material, by its option or the sheet option
  its name says, its thickness, and its price at its shop, whatever size it's given in) are cut from the biggest of
  them, so their parts are packed together and the sheet is bought, and costed, once. Braces given as the strips a
  shop cut from the top's plywood, priced as the sheet, come from that sheet, never a second one. A sheet of another
  thickness, option or price, or one with no price (offcuts to hand), stays its own.
- **The steps depend on the tools to hand;** the parts and the cut plan don't. The tools to hand are the owner's, as
  Your tools saves them, when given, else the parameters' own (#777). A step that can be done more than one way lists
  its ways, the one in use and the others not yet to hand: a hand saw, then a circular saw, then a mitre saw, the best
  to hand in use. A step started keeps the way it was started (`kept`), and one not started whose way differs from the one
  the parameters' own tools would use says so (`wayChanged`). A new tool changes only the steps it does better.
  Something else the owner has (`have`, their Things' names) stands in for a tool they haven't, named (`standIn`: a
  step stool for the long end, and only that: a mitre saw in the garage counts once it's in Your tools), and drill bits come with the bit each step drills with, and whether the owner's set
  has it (from the size it's kept with, in `sizes`), left out while that isn't known (#763).
- **A saw cuts only what fits it** (#780): a timber wider or deeper than the saw in use cuts (its **cutting capacity**,
  from the size line on the owner's tool, `sizes`) goes to the next best saw to hand that takes it, the hand saw taking anything,
  and the step says why in one line ("The 145 castor bases and top support are too wide for your mitre saw: hand saw
  for these"), and the picture draws the saw that cuts the timber shown. Its size is read only as a width by a depth
  ("120 × 60 mm"), or a circular saw's as a depth ("54 mm deep"); until it's given that way, a mitre saw is assumed to
  cut 100 mm wide and 60 deep, a circular saw 45 deep, and the line says it's assumed. A cut step started keeps
  its lines as they were: nothing is handed on once it is.
- **Each step says which parts it puts on the Build** (none for checking, marking and cutting), and something fitted
  (a castor) says the part it's fitted to, so the 3D view can build the Build up step by step (#699).
- **Each step has an ID** saying what it does ("fit-castors"), the same whichever steps the Build has, so the
  owner's progress stays on its step when one before it comes or goes.
- **Each step has a picture of the job as it's done** (#754): the length on the Workmate or in its jaws (clamped on the
  Workmate for a circular saw, or on a mitre saw's bed), an end frame flat on the floor, a castor base in the Workmate's jaws (or on two offcuts without one) with the drill in a plate's hole and its words as callouts off the model, or the frame as far as it's built.
  It says where it opens from (15° to 60° above level), and its marks (sizes, the pencil line, where the saw runs,
  the diagonals to check, where the support goes, where the brackets go, the waste side) are the Build's own numbers.
  Tools are drawn only when they're to hand, and nothing the owner doesn't have is drawn as if they did.
- **Marking starts by checking the end is square,** then one line per length, its pieces one at a time: each marked,
  cut and measured on from the fresh end, with no running totals (#789). Show me how walks through the first length's
  tape, tick, square and line (#777), and measure and mark draws them.
- **Every fixing a step makes is drawn by its type** (#813), on that step: an angle bracket in a corner, a bolt
  through a plate or a screwed overlap, each step's fixing saying its type (`joint`); a package test fails a step
  with a fixing whose type it doesn't show, or a pill longer than 3 words. **A technique** (measure and mark, driving a
  screw) is drawn in full the first time the steps use it, a "how?" tap after; the drill's clutch ring with the first
  long screw (60 mm or more), in full there too. The square drawn is the owner's kind, from Your tools (a speed square
  or an L-square, a plain one when it doesn't say), and their drill driver. Where brackets go on, the picture draws
  them as L-shapes, lit, in place of arrows.
- **The simplest way first** (#789): each step opens with how to batch it ("One joint at a time"), and has at most
  four lines. Sizes that decide how it turns out are measured; the rest is by eye (a joint's screw spots are 2
  crosses where the rail sits on the leg, a fingertip in, shown the first time). A pilot hole goes first only within
  25 mm of a piece's end, into MDF or hardwood, or for a screw over 6 mm, as one line at the screws; only the top is
  countersunk; extras are tips.
- **The castors go on after the frames** (#783), so a spanner still to get doesn't hold up the day, in four short
  lines as the board has them ("Castors in 3D, your kit · Fold (#783)"): each hole drilled through the plate's own hole
  and bolted loosely before the next, so none is off, and each bolt tightened with its head held, the tool's handle
  against the castor. Its tools are the owner's: the nut turned with their socket, adjustable or spanner, the head held
  with what's left (a spanner, an adjustable or pliers), one adjustable never two; what's missing is a chip not to
  hand. It opens on its batch line and those lines: no walk-through, and its extras (the drill's clutch, a hole
  that's off, starting the nut by hand, how tight is tight) are tips (#789). Its two close-ups are the board's:
  tightening, with the owner's tools drawn as their shapes, and one bolt taken apart (the castor, the bolt's head and
  the plate on top, the base, then the washers the Build has under the nut, against the wood, never under the head).
  A castor step started on its lines from before keeps them, so its ticks stay on the lines they were ticked on.
- **A bolt given too short is never fitted, nor said:** the steps and the buy list use the length to use instead,
  unpriced until it's given a price. Its buy-list line carries what it passes through and their sum, and, when the
  owner has bolts of its thread that are too short, by how much (#763). It's no finding: the old length means nothing
  to the owner.
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

## How a step reads

Written for a beginner holding a Fold at the bench, whoever they are and whatever tools they have. The key details
are always there, and the essays never are.

- **Steps follow the user's own tools, whatever they are:** the kind and how many (a speed square or an L-square, two
  clamps or four), with the technique and the picture for that kind, so the steps change as the kit grows. A tool
  that isn't known yet gets asked about then, with picture tiles, and never assumed.
- **The picture carries the key details:** what goes where, the order, the tool and the check. Each is drawn in 3D,
  the way the wood actually lies (a leg end is ▯ not ▭), with the tools as their real shape. Labels are 2-3 words, as
  pills off the wood; numbered badges match the step's numbered lines. A fixing of several parts is drawn exploded,
  so it's clear which side each piece goes.
- **About 4 short lines a step,** one action each. The how and why sit behind "Show me how", and extras are tips.
- **The order is said, never left to guess:** square, then clamp, then a screw; one piece or one joint at a time,
  and "together" only for identical setups. A picture that shows a square says when the clamp comes, and the other
  way round. If it needs more than one moment, it's a strip of small frames.
- **Every mark says "by eye" or "measure":** measure cut lengths, matching pieces, square and a flush top; screw
  spots, clamp spots and centring are by eye, with the area drawn ("anywhere in the green").
- **Simplest way first, still in good nick:** pilot holes or countersinking only where they matter (near an end, in
  hardwood, on a top), as one line.
- **A missing key detail is a bug, and so is an extra paragraph.**

## Tests

`cut-plan.test.ts` (packing, whatever the pieces), `recipe/recipe.test.ts` (the golden bench as a recipe, written by
hand in `recipe/fixtures/golden-bench.ts`, giving the template's own Build, by tools and variants; its starter
writing exactly that recipe; and what a recipe is refused for), `recipe/any-recipe.test.ts` (the golden bench worked
out as any recipe is, to the template's numbers; and invented recipes, `recipe/fixtures/invented.ts`, a box, a rack
and a saw stand: their parts and lengths by hand, a cut plan that fits, a buy list that matches it, the owner's stock
used first, a pick, and what can't be placed), `recipe/checks.test.ts` (a 1200 mm span of 12 mm ply under paint
tins sagging, with a centre support; the plainest fixes that pass; loads in plain words; a tall narrow rack tipping,
and a tall stand on castors; a frame with no brace; screws too short to grip and long enough to come out the far side), `close-ups/close-ups.test.ts` (each close-up type following its
pieces' sizes, a made-up 70 × 70 corner's bracket sized to it; the guard; and which bench steps show which, in full
or as a tap), `bench/bench.test.ts` (the golden bench, the garage workbench's
hand-checked numbers with invented names, in `bench/fixtures/golden.ts`), `bench/scenes.test.ts` (each step's picture
for the golden bench, by the tools to hand, and the walk-throughs), `bench/your-tools.test.ts` (the steps following
the owner's tools, a step started kept as it was started, tools found by the words in their names, a stand-in, bits by
size, tools chosen to buy), `bench/saw-capacity.test.ts` (cuts too big for a saw going to one that takes them, given
or assumed), `print/print.test.ts` (the golden holster and shim, `print/fixtures/golden.ts`:
their size and volume worked out by hand, closed all round, the pocket allowing the clearance), `print/recipe.test.ts`
(what a recipe is refused for) and `print/make.test.ts` (what a checked recipe still can't be made into).

## Used by

The worker's `features/fabrication/` (#697), which keeps a planning workspace's Builds, works each out with it, and
makes a printed part in a thread of its own (#702); its `prompts/builds.ts`, which gives a model each template's
parameters as JSON Schema; and Fabrication (`apps/fabrication`, #698, #699), which shows all it works out, the steps
as an instruction manual, and a printed part on its plate.
