# builds

A Build's page in Fabrication (#698; Paper, 2 · Agreed, "Fabrication · A Build · Desktop 1440×900 (#698)"; on the Fold,
#753: "Fabrication · At the bench · Fold 933×645", "· At the bench · Cover 476×695" and "· Plan · Fold 933×645"):
everything `packages/fabrication` works out for it, and a chat about it.

**Example:** the owner taps Open in Fabrication on "Build the workbench" in Courtyard. On the unfolded Fold it opens
at the bench, on the step they'd reached: "Cut and label the timber" in big type beside the step in 3D. They hold Hold
to ask, say "does the offcut need support?", let go, and the answer shows over the picture. Plan shows the bench
turning in 3D, its cut plan with each offcut's length, and "M6 × 50 bolts too short" in gold.

- **Uses:** Fabrication's API through `api/fabrication.ts` (the Build and where it is, its progress, a stock picked
  and its Undo, its chat, the models, a printed part made and its files), `packages/ui` (the Reply box, Talk's
  listening and its tap or hold, how an answer's Markdown looks, the sheet, the segmented choice, `Scroller`, `useKept`,
  `CapsLabel`) and `three` for the 3D view.
- **Used by:** the route `routes/workspaces.$id.builds.$slug.tsx`.

| File | What it is |
|---|---|
| `build-page.tsx` | The page: the top bar (back to its project, its name, the step's dots or its size, "N to check", At the bench or Plan), then the Fold's way of working, or three panels on a computer |
| `at-the-bench.tsx` | At the bench (the step big beside it in 3D, stacked when folded) and Plan (the Build big in 3D beside its tabs) |
| `chat/build-chat.tsx` | The chat, once for the page (`useBuildChat`), and its view: what's been said in its session, answers formatted as Courtyard's are, each change saved, and the Reply box |
| `chat/chat-dock.ts` | Where the Reply box sits in the chat, with no Handheld frame, and its mic listening |
| `chat/hold-to-ask.tsx` | Hold to ask, and the answer it brings over the picture, or that it didn't answer, with Try again |
| `bench-panel.tsx` | The 3D panel: its label, Reset view, what sits at its foot, and a part's card |
| `bench-view.tsx` | The scene itself, `three`, loaded lazily so only this page loads it: fitted to its panel, its letters apart |
| `cut-plan.tsx` | Each length of timber as a bar of its cuts and its offcut, and each sheet with its pieces where they sit, each with its size |
| `buy-list.tsx` | What to buy, from where, how many and for how much, with the total; a timber or sheet with options opens them |
| `stock-options.tsx` | A stock's options (#704; "Fabrication · Choose materials · Tablet (#704)"): the recommended first, each costed, Pick, and Undo of the pick just made; `useStockOptions`, which stock's are open |
| `tools-list.tsx` | The tools needed against what's to hand |
| `step-panel.tsx` | The steps as an instruction manual (#699): one step, its checklist, its tools, the check before moving on |
| `step-moves.tsx` | Moving between steps: Back and Done, a swipe, and the dots that show how far |
| `close-up.tsx` | A step's close-up, drawn to scale: its sizes and where each fixing goes |
| `progress.ts` | The step reached and the lines ticked, kept for every device; what the 3D view shows at a step |
| `print/print-panel.tsx` | A printed part's own (#702; "Fabrication · Text to print · Tablet (#702)"): the part on the plate, and the Print tab with its sizes and sources, its file, Open in Bambu Studio (its 3MF) and Send to printer, waiting for one |
| `print/print-view.tsx` | The printed part's scene, `three`, on the printer's plate, loaded lazily as the bench's is |
| `findings.tsx` | What the making rules found that needs the owner, in gold; for a printed part, each size assumed too |
| `words.ts` | How the numbers read: money, sizes, stock, the findings' words |

**Screens:** a part tapped in the 3D view, its letter, its name in the key (on a computer) or a piece in the cut plan
is lit in all of them and opens its card; tapping again, or ×, closes it. The 3D view fits what it shows to its panel,
turned as the owner left it, and Reset view turns it back; a part's letter that would sit on another's moves to the
nearest clear spot. Each piece in the cut plan shows its size: beside its letter, on the next line when it's
narrow, turned along a tall piece, or in lines of its own, and its letter alone only when none of those fit; each
timber bar's offcut shows its length, in the bar or on its line when the bar has no room. A buy-list row or a cut plan's Options opens that stock's options in the side panel (in Plan on
the Fold), in place of its tab, until a tab or ‹ Buy list is tapped. A printed part (#702) shows on the printer's
plate in place of the bench, its Print tab before its buy list.

**On the Fold** (#753): **At the bench** is where a Build with steps opens: the step's label, title and checklist in
big type, its tools as chips (gold where one's to check), Back and "Done, next step" at thumb height, and a swipe on
the step for the next or the one before. The dots in the top bar show how far, and are nothing to tap. Beside it, the
step in 3D with **Hold to ask**: held, it listens and shows what will be sent ("Step 3, Cut and label the timber: …");
let go, it's asked in the chat, and the answer shows over the picture, closing by itself 30 seconds after it has
all come; one that fails or never comes says "It didn't answer." with Try again, until it's closed. A tap
opens the chat. **Plan**, one tap away in the top bar, is the Build big in 3D with Hold to ask and
Chat, and its cut plan, buy list and tools as tabs under what the making rules found. The chat is a sheet from the
right, open on its latest. Folded, it's At the bench alone, stacked: the step in 3D above, the step below.

**Steps** (#699; Paper, 2 · Agreed, "Fabrication · Build steps v2, teaching · Tablet (#699)", "· Build steps, cutting
by your tools · Tablet (#699)" and "· Build steps · Cover (#699)"): the step reached, and the 3D view built up to it:
the parts put on before are faint, the step's own violet, the rest hidden. A step has its time, a checklist whose
ticked lines go grey and whose next line is lit, words such as "flush" to tap for a line saying what they mean, its
tools, its fixings, what the making rules found about it in gold (bolts too short, and the length the step uses
instead), its close-up, "Before you move on" with Send a photo to check (the photo and what it's for go in the chat's
Reply box, to send), how it's done ("Hand saw", "Circular saw · not yet") and "Show me how" or "Just the numbers"
(kept on the device). On a computer the steps are the side panel's Steps tab, with the close-up under the 3D view.
The page opens on the steps once building has started, and the Fold, the PC and a new session all carry on from
where the owner left off.
