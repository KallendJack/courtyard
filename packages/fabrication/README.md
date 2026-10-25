# Fabrication's engine

`@courtyard/fabrication` turns a Build's template and parameters into everything the Build shows (ADR 0036): its
parts, cut plan, buy list, steps and making-rule findings. Plain functions, importing nothing from the worker, the
web app, the file system or a model, so it could ship on its own. Its only Courtyard import is the contract's
`SourcedSize`, the value-with-source shape every size takes.

## Example

```ts
import { deriveBench } from "@courtyard/fabrication";

const derived = deriveBench(parameters); // a framed bench's parameters, as JSON
if (derived.ok) derived.value.cutPlan; // 4 lengths of B 1450 + A 750, 1 of 5 × 460…
else derived.error; // ["height.source: Invalid input…"]
```

## What's in it

| File | What it does |
|---|---|
| `index.ts` | What callers import |
| `build.ts` | What a template derives: parts with a box each for the 3D view, the cut plan, the buy list, steps, findings |
| `stock.ts` | What parts are cut from and fixed with: timber, sheets, fixings and their prices. A template takes each slot's stock as a parameter, so a slot can be swapped (#704) |
| `cut-plan.ts` | Packing: timber pieces into lengths and sheet pieces into sheets, the kerf between every two |
| `buy-list.ts` | Whole lengths, sheets and packs, at the prices given; an unpriced line is counted, never guessed |
| `findings.ts` | The making rules code checks: a bolt long enough for what it passes through plus two threads, tools needed and not to hand, sizes assumed |
| `tools.ts`, `glossary.ts` | The tools and kit a step can need, and the words a beginner may not know |
| `bench/` | The first template, the framed bench: `parameters.ts`, `frame.ts` (where each piece goes), `preparing.ts` and `steps.ts` (each action in "show me how" and "just the numbers"), `close-ups.ts` |

## The rules it keeps

- **Every size has a source** (`measured`, `specified` with its reference, or `assumed`); one without is refused.
- **Castors left out are none,** so a change that takes them out (a merge patch's `null`) leaves a bench on its legs.
- **A cut plan never overruns** a length or a sheet, with the kerf counted between pieces; a part bigger than its
  stock is found and left out.
- **The steps depend on the tools to hand;** the parts and the cut plan don't. A step that can be done more than one
  way lists its ways, the one in use and the others not yet to hand (a hand saw until there's a circular saw).
- **Each step says which parts it puts on the Build** (none for checking, marking and cutting), and something fitted
  (a castor) says the part it's fitted to, so the 3D view can build the Build up step by step (#699).
- **Each step has an ID** saying what it does ("fit-castors"), the same whichever steps the Build has, so the
  owner's progress stays on its step when one before it comes or goes.
- **A fixing found too short is never fitted:** the steps and the buy list use the length to use instead, unpriced
  until it's given a price, and the finding names the steps that fit it.
- **Parts are cut to the whole mm below,** and the steps say every size to the whole mm; the Build keeps it exact.

## Tests

`cut-plan.test.ts` (packing, whatever the pieces) and `bench/bench.test.ts` (the golden bench, the garage
workbench's hand-checked numbers with invented names, in `bench/fixtures/golden.ts`).

## Used by

The worker's `features/fabrication/` (#697), which keeps a planning workspace's Builds and works each out with it, and
its `prompts/builds.ts`, which gives a model the bench's parameters as JSON Schema; and Fabrication
(`apps/fabrication`, #698, #699), which shows all it works out, the steps as an instruction manual.
