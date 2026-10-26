# builds

A Build's page in Fabrication (#698; Paper, 2 · Agreed, "Fabrication · A Build · Desktop 1440×900 (#698)"; on the Fold,
#753: "Fabrication · At the bench · Fold 933×645", "· At the bench · Cover 476×695" and "· Plan · Fold 933×645"):
everything `packages/fabrication` works out for it, and a chat about it.

**Example:** the owner taps Open in Fabrication on "Build the workbench" in Courtyard. On the unfolded Fold it opens
at the bench, on the step they'd reached: "Cut and label the timber" in big type beside the step in 3D. They hold Hold
to ask, say "does the offcut need support?", let go, and the answer shows over the picture. Plan shows the bench
turning in 3D, its cut plan with each offcut's length, and on its Tools tab "2 to sort": the drill bits to check in
their set, and the countersink bit, with Have it and Add to list.

- **Uses:** Fabrication's API through `api/fabrication.ts` (the Build and where it is, its progress, a stock picked
  and its Undo, its chat, the models, a printed part made and its files, Your tools saved from the Tools tab and its
  Undo), `features/tools/picks.ts` (a tool had, added to Your tools), `packages/ui` (the Reply box, Talk's
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
| `bench-view.tsx` | The scene itself, `three`, loaded lazily so only this page loads it: the whole Build, or a step's picture with its marks, fitted to its panel, its letters apart, and its callouts' leaders (#783) |
| `scene.ts` | What `bench-view.tsx` draws a scene with: where the camera goes and how far it may tilt, the marks' lines and words, the waste side's hatching, the marks' words and the letters kept apart and inside the picture; the parts' letters |
| `picture/callouts.ts` | Where a picture's callouts go (#783): off the model (each box's outline on screen), clear of the other words, the title and the buttons at its foot, with a short leader; over the model only when a small picture has no room |
| `cut-plan.tsx` | Each length of timber as a bar of its cuts and its offcut, and each sheet with its pieces where they sit, each with its size; a length as it's marked, with the saw's cut between pieces |
| `buy-list.tsx` | What to buy, from where, how many and for how much, with the total; a timber or sheet with options opens them; a bolt's "Why 65 mm?" opens what it passes through, and its line says when the owner's own are short (#763) |
| `stock-options.tsx` | A stock's options (#704; "Fabrication · Choose materials · Tablet (#704)"): the recommended first, each costed, Pick, and Undo of the pick just made; `useStockOptions`, which stock's are open |
| `tools-list.tsx` | The tools needed against what's to hand, said once (#763; "Fabrication · Tools and warnings · Fold"): "N to sort" first, each with what to do (Have it, added to the tools the Build counts as theirs in Your tools, with Undo; or Add to list, onto the buy list, with Undo, a bit the set lacks too), drill bits by size with "How do I tell a bit's size?", then what's to hand, a stand-in named ("Your step stool will do") |
| `step-panel.tsx` | The steps as an instruction manual (#699): one step, what's changed with Your tools, its walk-through, its checklist, its tools, the check before moving on |
| `step-moves.tsx` | Moving between steps: Back and Done, a swipe, and the dots that show how far |
| `close-up.tsx` | A step's close-up, drawn to scale: its sizes, where each fixing goes, tools as their shape (an open spanner, an adjustable, pliers, a socket on a hex) and a castor as one (#783), and its words over it at the type's own sizes, never under 12 px |
| `progress.ts` | The step reached, the lines ticked and the tools chosen to buy, kept for every device |
| `print/print-panel.tsx` | A printed part's own (#702; "Fabrication · Text to print · Tablet (#702)"): the part on the plate, and the Print tab with its sizes and sources, its file, Open in Bambu Studio (its 3MF) and Send to printer, waiting for one |
| `print/print-view.tsx` | The printed part's scene, `three`, on the printer's plate, loaded lazily as the bench's is |
| `findings.tsx` | What the making rules found that needs the owner, in gold, but a bench's tools, which its Tools tab says; for a printed part, each size assumed too |
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
step in 3D with **Hold to ask**: held, it listens through any pause, listening out for the step's parts, tools and
words, and shows what will be sent ("Step 3, Cut and label the timber: …"); let go, it's asked in the chat. Let go on
a few words, or on one like "and", it waits 3 seconds for **Hold to add more** before it's asked (#787). The answer shows over the picture, closing by itself 30 seconds after it has
all come; one that fails or never comes says "It didn't answer." with Try again, until it's closed. A tap
opens the chat. **Plan**, one tap away in the top bar, is the Build big in 3D with Hold to ask and
Chat, and its cut plan, buy list and tools as tabs under what the making rules found. The chat is a sheet from the
right, open on its latest. Folded, it's At the bench alone, stacked: the step in 3D above, the step below.

**Steps** (#699; Paper, 2 · Agreed, "Fabrication · Build steps v2, teaching · Tablet (#699)", "· Build steps, cutting
by your tools · Tablet (#699)" and "· Build steps · Cover (#699)"): the step reached, and in 3D its picture (#754;
"Fabrication · At the bench · Fold 933×645"), the job as it's done, worked out by the engine: the length on the
Workmate with its first piece's line, the length in its jaws with the line, the saw, the support under the long
end and the offcut hatched on the waste side, an end frame flat on the floor with its diagonals, a castor base in the
Workmate's jaws with a bolt in and the drill in the plate's next hole, its words callouts off the model with short leaders, gold for the owner's own tools and green for what's next (#783; "Castors in 3D, your kit · Fold"), or the frame so far (the parts put on before faint, the step's own violet, the rest hidden). Its
marks are the Build's own numbers; only the tools to hand are drawn. Each step opens at its own angle, fitted to the
view; turning stays between 15° and 60° above level, and Reset view (or another step) puts it back. Only the step's
own parts have their letter, and a new step closes a part's card. The marks' words are the step's own type size (20 px
beside a step in big type, 16 px otherwise), and none sits on another or on a letter (#777). A step has its time and,
under its title, how to batch it ("One joint at a time", #789); a
line in violet when Your tools have changed how a step is done ("Cut and label the timber now uses your mitre saw, not
the hand saw.", #777); under "Show me how", a walk-through the first time a move comes up (marking as 1. Tape,
2. Tick, 3. Square, 4. Line, with close-ups of the tape's hook and the square's stock; marking the screw spots on the
end frames, with a close-up of where the rail sits on the leg, #789); a checklist whose ticked lines
go grey and whose next line is lit (marking puts a bar under each length's line, "B 1450 · 3 mm saw cut · A 750 ·
offcut 197"), words such as "flush" to tap for a line saying what they mean, Tips closed until tapped (#789), its tools (drill bits by size, "a 7 mm
bit: check your set" in gold while the set's sizes aren't known; a stand-in by name, "Support for the long end: your
step stool", #763), its fixings, what the making rules found about it in gold (a part too big for its stock), its
close-ups (the castors' two: tightening with the owner's tools, and one bolt apart), "Before you move
on" with Send a photo to check (the photo and what it's for go in the chat's Reply box, to send), how it's done ("Hand
saw", "Circular saw · not yet", "Mitre saw · not yet") and "Show me how" or "Just the numbers" (kept on the device). On a computer the steps
are the side panel's Steps tab, with the close-up under the 3D view. The page opens on the steps once building has
started, and the Fold, the PC and a new session all carry on from where the owner left off.
