# sizes

A space's sizes in Fabrication (#709; Paper, 2 · Agreed, "Fabrication · Sizes in the room's Things panel · Tablet
(#709)"): the space's size records and those of the Things in it, each with where it came from, corrected with Undo.
Fabrication owns the records; Courtyard keeps them in the workspace's `sizes` folder (ADR 0037).

**Example:** the owner opens the garage. Its old sizes, found in Facts and the project's history, are listed once;
they tick Measured for the length and record the rest as about. The guided re-measure then shows Inside width, "wall
to wall, at the back, on the floor"; they type 2741, Save, and the line reads "measured · just now", "was about 2735",
with Undo at the foot.

- **Uses:** Fabrication's API through `api/fabrication.ts` (a space's sizes, + Size, a correction, one answer kept,
  the old sizes confirmed, and Undo), `components/to-check.tsx` (the header's "N to check", a Build's
  too), and `packages/ui` (buttons, chips, `SegmentedChoice`, `Sheet`, `Scroller`).
- **Used by:** the route `routes/workspaces.$id.spaces.$slug.tsx`, and a Build's page, whose Cut plan and Print tabs
  show the sizes its steps need (`BuildSizesBlock`, read with the Build).

| File | What it is |
|---|---|
| `space-page.tsx` | The page: the space's name and how far the re-measure has got, the size being measured beside the Things panel (over it, folded), the old sizes, and Undo |
| `size-lines.tsx` | A Thing's sizes: its name and kind, + Size, and a line for each size, lit where the re-measure is |
| `size-form.tsx` | A size measured, corrected or added, measured or about; its answers to keep one when they disagree |
| `old-sizes.tsx` | The old sizes found in sentences, each Measured, About or Leave out, recorded once |
| `build-sizes.tsx` | The sizes a Build's steps need, as its space shows them, with a link to measure them there |
| `words.ts` | A source as a word, a value, its day, and what's happening with a line |

**Screens:** a line says what's happening with its size: "measured · just now" in moss, "about · to measure" or "two
answers · check by tapping it" in gold, "measuring next · back wall to the door" in violet. Tapping a line opens it to
correct, or to keep one answer of two. The header counts the sizes measured of those needed and the sizes to check.
