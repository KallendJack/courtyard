# builds

A Build's page in Fabrication (#698; Paper, 2 · Agreed, "Fabrication · A Build · Tablet (#698)", "· Desktop 1440×900
(#698)" and "· A Build, buy list · Cover (#698)"): everything `packages/fabrication` works out for it, and a chat about
it.

**Example:** the owner taps Open in Fabrication on "Build the workbench" in Courtyard. The page shows the bench
turning in 3D, its cut plan, "M6 × 50 bolts too short" in gold, and the chat they had about it; they say "make it
850 high", the session saves the change, and every number on the page moves with it.

- **Uses:** Fabrication's API through `api/fabrication.ts` (the Build and where it is, its progress, a stock picked
  and its Undo, its chat, the models),
  `packages/ui` (the Reply box, Talk, `Scroller`, `useKept`, `CapsLabel`) and `three` for the 3D view.
- **Used by:** the route `routes/workspaces.$id.builds.$slug.tsx`.

| File | What it is |
|---|---|
| `build-page.tsx` | The page: the top bar (back to its project, its name and size, "N to check"), then three panels, or tabs on the cover screen |
| `build-chat.tsx` | The chat: what's been said in its session, each change saved, and the Reply box |
| `chat-dock.ts` | Where the Reply box sits in the chat panel, with no Handheld frame, and its mic listening |
| `bench-panel.tsx` | The 3D panel: its key, and a part's card |
| `bench-view.tsx` | The scene itself, `three`, loaded lazily so only this page loads it: the whole Build, or a step's picture with its marks and Reset view |
| `scene.ts` | What `bench-view.tsx` draws a scene with: where the camera goes and how far it may tilt, the marks' lines and words, the waste side's hatching |
| `cut-plan.tsx` | Each length of timber as a bar of its cuts, and each sheet with its pieces where they sit; a length as it's marked, with the saw's cut between pieces |
| `buy-list.tsx` | What to buy, from where, how many and for how much, with the total; a timber or sheet with options opens them |
| `stock-options.tsx` | A stock's options (#704; "Fabrication · Choose materials · Tablet (#704)"): the recommended first, each costed, Pick, and Undo of the pick just made |
| `tools-list.tsx` | The tools needed against what's to hand |
| `step-panel.tsx` | The steps as an instruction manual (#699): one step, its checklist, Back and Done, the step strip |
| `close-up.tsx` | A step's close-up, drawn to scale: its sizes and where each fixing goes |
| `progress.ts` | The step reached and the lines ticked, kept for every device |
| `findings.tsx` | What the making rules found that needs the owner, in gold |
| `words.ts` | How the numbers read: money, sizes, stock, the findings' words |

**Screens:** a part tapped in the 3D view, its letter in the key or a piece in the cut plan is lit in all of them and
opens its card; tapping again, or ×, closes it. A buy-list row or a cut plan's Options opens that stock's options in
the side panel, in place of its tab, until a tab or ‹ Buy list is tapped.

**Steps** (#699; Paper, 2 · Agreed, "Fabrication · Build steps v2, teaching · Tablet (#699)", "· Build steps, cutting
by your tools · Tablet (#699)" and "· Build steps · Cover (#699)"): the Steps tab shows the step reached, and the 3D
view shows its picture (#754; "Fabrication · At the bench · Fold 933×645"), the job as it's done, worked out by the
engine: the length on the Workmate with a pencil tick at each piece, the length in its jaws with the line, the saw,
the support under the long end and the offcut hatched on the waste side, an end frame flat on the floor with its
diagonals, a castor base upside down with its bolts, or the frame so far (the parts put on before faint, the step's
own violet, the rest hidden). Its marks are the Build's own numbers; only the tools to hand are drawn. Each step
opens at its own angle; turning stays between 15° and 60° above level, and Reset view (or another step) puts it
back. Only the step's own parts have their letter, and a new step closes a part's card. A step has
its time, how it's done ("Hand saw", "Circular saw · not yet"), "Show me how" or "Just the numbers" (kept on the
device), a checklist whose ticked lines go grey and whose next line is lit (marking puts a bar under each length's
line, "B 1450 · 3 mm saw cut · A 750 · offcut 197"), words such as "flush" to tap for a line
saying what they mean, its fixings, what the making rules found about it in gold (bolts too short, and the length
the step uses instead), "Before you move on" with Send a photo to check (the photo and what it's for go
in the chat's Reply box, to send), and its tools on one line ("5 tools ready · 1 to check") that opens to each. Back
and Done, next step are pinned at the foot; the strip of dots above the 3D view (done · now · to go) jumps to a
step. The page opens on the steps once building has started, and the Fold, the PC and a new session all carry on
from where the owner left off.
