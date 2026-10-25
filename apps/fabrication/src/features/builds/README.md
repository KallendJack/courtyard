# builds

A Build's page in Fabrication (#698; Paper, 2 · Agreed, "Fabrication · A Build · Tablet (#698)", "· Desktop 1440×900
(#698)" and "· A Build, buy list · Cover (#698)"): everything `packages/fabrication` works out for it, and a chat about
it.

**Example:** the owner taps Open in Fabrication on "Build the workbench" in Courtyard. The page shows the bench
turning in 3D, its cut plan, "M6 × 50 bolts too short" in gold, and the chat they had about it; they say "make it
850 high", the session saves the change, and every number on the page moves with it.

- **Uses:** Fabrication's API through `api/fabrication.ts` (the Build and where it is, its chat, the models, a
  printed part made and its files),
  `packages/ui` (the Reply box, Talk, `Scroller`, `useKept`, `CapsLabel`) and `three` for the 3D view.
- **Used by:** the route `routes/workspaces.$id.builds.$slug.tsx`.

| File | What it is |
|---|---|
| `build-page.tsx` | The page: the top bar (back to its project, its name and size, "N to check"), then three panels, or tabs on the cover screen |
| `build-chat.tsx` | The chat: what's been said in its session, each change saved, and the Reply box |
| `chat-dock.ts` | Where the Reply box sits in the chat panel, with no Handheld frame, and its mic listening |
| `bench-panel.tsx` | The 3D panel: its key, and a part's card |
| `bench-view.tsx` | The scene itself, `three`, loaded lazily so only this page loads it |
| `cut-plan.tsx` | Each length of timber as a bar of its cuts, and each sheet with its pieces where they sit |
| `buy-list.tsx` | What to buy, from where, how many and for how much, with the total |
| `tools-steps.tsx` | The tools needed against what's to hand, and the steps in order |
| `print-panel.tsx` | A printed part's own (#702; "Fabrication · Text to print · Tablet (#702)"): the part on the plate, and the Print tab with its sizes and sources, its file, Open in Bambu Studio (its 3MF) and Send to printer, waiting for one |
| `print-view.tsx` | The printed part's scene, `three`, on the printer's plate, loaded lazily as the bench's is |
| `findings.tsx` | What the making rules found that needs the owner, in gold; for a printed part, each size assumed too |
| `words.ts` | How the numbers read: money, sizes, stock, the findings' words |

**Screens:** a part tapped in the 3D view, its letter in the key, a piece in the cut plan or a step's letter is lit in
all of them and opens its card; tapping again, or ×, closes it.
