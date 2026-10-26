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
| `bench-panel.tsx` | The 3D panel: its label, Reset view (not at the bench), what sits at its foot (in its label's row, folded at the bench), and a part's card; at the bench unfolded, the step's close-ups beside the model and where it goes (#826) |
| `picture/scene-words.tsx` | The words over the model: its marks, the callouts' leaders, and each part lit at the step, a letter on a computer or a pill with its leader at the bench |
| `picture/fitted.ts` | Where a close-up's drawing sits in its box, in the middle or at its left, so its words go over it at their own size |
| `picture/close-up-card.tsx` | A close-up at the bench (#826): its drawing, titled, with its answers ("By eye" or "Measure", "Drill first" or "Just screw") |
| `picture/where-this-goes.tsx` | "Where this goes" (#826): the whole Build small, this step's pieces vivid and the rest outlined, tapped to show it big |
| `bench-view.tsx` | The scene itself, `three`, loaded lazily so only this page loads it: the whole Build, or a step's picture with its marks, fitted to its panel, its letters apart, and its callouts' leaders (#783) |
| `scene.ts` | What `bench-view.tsx` draws a scene with: where the camera goes and how far it may tilt, the marks' lines and words, the waste side's hatching, the marks' words and the letters kept apart and inside the picture; the parts' letters |
| `picture/callouts.ts` | Where a picture's callouts go (#783): off the model (each box's outline on screen), clear of the other words, the title and the buttons at its foot, with a short leader; over the model only when a small picture has no room |
| `cut-plan.tsx` | Each length of timber as a bar of its cuts and its offcut, and each sheet with its pieces where they sit, each with its size; a length as it's marked, with the saw's cut between pieces |
| `buy-list.tsx` | What to buy, from where, how many and for how much, with the total; a timber or sheet with options opens them; a bolt's "Why 65 mm?" opens what it passes through, and its line says when the owner's own are short (#763) |
| `stock-options.tsx` | A stock's options (#704; "Fabrication · Choose materials · Tablet (#704)"): the recommended first, each costed, Pick, and Undo of the pick just made; `useStockOptions`, which stock's are open |
| `tools-list.tsx` | The tools needed against what's to hand, said once (#763; "Fabrication · Tools and warnings · Fold"): "N to sort" first, each with what to do (Have it, added to the tools the Build counts as theirs in Your tools, with Undo; or Add to list, onto the buy list, with Undo, a bit the set lacks too), drill bits by size with "How do I tell a bit's size?", then what's to hand, a stand-in named ("Your step stool will do") |
| `step-panel.tsx` | The steps as an instruction manual (#699): one step, what's changed with Your tools, its walk-through, its checklist, its tools, the check before moving on |
| `step/how.tsx` | A step's walk-through, its check before moving on, and the photo picker for it |
| `step/bench-step.tsx` | A step at the bench as its boards have it (#826), and nothing else: its number and time, title, numbered lines with their boxes and tools as chips; pinned under them its four buttons, Back and Done |
| `step/step-buttons.tsx` | At the bench (#793), the step's four buttons under its lines: Show me how, Is this right?, I don't have… and Can't do this now, what each opens, and a parked step's line with Do it now |
| `step-moves.tsx` | Moving between steps: Back and Done, a swipe, and the dots that show how far |
| `close-up.tsx` | A step's close-up, drawn to scale: its sizes, where each fixing goes, and its words over it at the type's own sizes, never under 12 px; a close-up by type (#813) as the engine draws it in 3D, its faces, pencil marks and screws' ways in, with its labels as pills, a badge for each move and a leader to what it's about; and a step's techniques, in full the first time, a "How?" tap after |
| `picture/close-up-shapes.tsx` | Tools as their shape in a close-up (an open spanner, an adjustable, pliers, a socket on a hex) and a castor as one (#783) |
| `progress.ts` | The step reached, the lines ticked, the tools chosen to buy and the steps parked, kept for every device |
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

**On the Fold** (#753): **At the bench** is where a Build with steps opens, as its boards have it and nothing else
(#826; "Fabrication · End frames in 3D, your kit · Fold" and "· Castors in 3D, your kit · Fold"): the step and its
time, its title, at most four short numbered lines with their boxes, its tools as chips (the drill and its bit as one,
gold where one's to check), then pinned its four buttons, Back and "Done, next step", and a swipe on the step for the
next or the one before. Open, the step never scrolls; what a button opens shows over its lines. The dots in the top
bar show how far, and are nothing to tap. Beside it, the step in 3D, titled with what it shows: this step's pieces in
their wood's colour, supports grey and tools orange, framed close on what the step works on so it fills the picture
(the end frame itself), each part a pill off the wood with its leader (none where the picture's callouts say what's
what, as on the castors), a numbered badge where each line is done, a dot on each screw spot the board marks and the
length as a gold tag beside its dimension line; unfolded, the step's close-ups beside it with their answers (a
piece's name in its wood, what's underneath in red), and "Where this goes" in its corner, saying what the step's
pieces make ("The two ends · tap"). With it, **Hold to ask**, dark with its mic in a violet circle: held, it listens through any pause, listening out for the step's parts, tools and
words, and shows what will be sent ("Step 3, Cut and label the timber: …"); let go, it's asked in the chat. Let go on
a few words, or on one like "and", it waits 3 seconds for **Hold to add more** before it's asked (#787). The answer is
a card over the picture, just above Hold to ask (#793; "Fabrication · Asking at the bench: step buttons + answer card · Fold (#793)"): "You
asked: …", the answer and ×, closing by itself 30 seconds after it has all come; one that fails or never comes says
"It didn't answer." with Try again, until it's closed. The step never changes, and there's no chat at the bench: a
tap on Hold to ask opens it in Plan. Under the step's lines, four buttons: **Show me how** opens its walk-through,
close-ups, tips, fixings, which saw it'll be and the check before moving on; **Is this right?** takes a photo and asks it against the step, answered on
the card; **I don't have…** lists only the step's tools, parts and fixings, and one picked says what stands in for it
from Your tools, or offers Park this step; **Can't do this now** (in gold) parks the step with why (Missing
something, Went wrong, Out of time). A parked step is kept with why, the next step not done or parked comes up, and
back on it a gold line says why with Do it now (Done takes it off too). **Plan**, one tap away in the top bar, is the Build big in 3D with
Hold to ask and Chat, and its cut plan, buy list and tools as tabs under what the making rules found. The chat is a
sheet from the right, open on its latest. Folded, it's At the bench alone, stacked: the step in 3D above, with Hold
to ask in its heading clear of the model, the step below as tall as its lines need, so all of them show, and the chat
a sheet over it.

**Steps** (#699; Paper, 2 · Agreed, "Fabrication · Build steps v2, teaching · Tablet (#699)", "· Build steps, cutting
by your tools · Tablet (#699)" and "· Build steps · Cover (#699)"): the step reached, and in 3D its picture (#754;
"Fabrication · At the bench · Fold 933×645"), the job as it's done, worked out by the engine: the length on the
Workmate with its first piece's line, the length in its jaws with the line, the saw, the support under the long
end and the offcut hatched on the waste side, an end frame flat on the floor with its diagonals, a castor base in the
Workmate's jaws with a bolt in and the drill in the plate's next hole, its words callouts off the model with short leaders, gold for the owner's own tools and green for what's next (#783; "Castors in 3D, your kit · Fold"), or the frame so far (the parts put on before faint, the step's own violet, the rest hidden; the brackets a step fits as the L-shapes they are, violet, #813). Its
marks are the Build's own numbers; only the tools to hand are drawn. Each step opens at its own angle, fitted to the
view; turning stays between 15° and 60° above level, and Reset view (or another step) puts it back. Only the step's
own parts have their letter, and a new step closes a part's card. No mark's words sit on another or on a letter
(#777). Every screw spot and mark says how it's placed, "By eye" or "Measure" with its number, and a screw spot
whether it's "Drill first" (by the pilot rule, #795) or "Just screw", straight in (#826). A step has its time and, on a computer,
under its title, how to batch it ("One joint at a time", #789); a
line in violet when Your tools have changed how a step is done ("Cut and label the timber now uses your mitre saw, not
the hand saw.", #777); under "Show me how", a walk-through the first time a move comes up (marking as 1. Tape,
2. Tick, 3. Square, 4. Line; marking the screw spots on the end frames, #789); a checklist whose ticked lines
go grey and whose next line is lit (marking puts a bar under each length's line, "B 1450 · 3 mm saw cut · A 750 ·
offcut 197"), words such as "flush" to tap for a line saying what they mean, Tips closed until tapped (#789), its tools (drill bits by size, "a 7 mm
bit: check your set" in gold while the set's sizes aren't known; a stand-in by name, "Support for the long end: your
step stool", #763), its fixings, what the making rules found about it in gold (a part too big for its stock), its
close-ups (each fixing it makes by its type, #813: a bracket in a corner pulled out, a screwed overlap's green, the
castors' bolt through a plate, tightening with the owner's tools and one bolt apart), its techniques (measure and
mark, with the owner's square; driving a screw, its end zone and, the first time a long screw goes in, the drill's
clutch ring) in full the first time the Build's steps use each, then a "How?" tap that opens it, "Before you move
on" with Send a photo to check (the photo and what it's for go in the chat's Reply box, to send), how it's done ("Hand
saw", "Circular saw · not yet", "Mitre saw · not yet") and "Show me how" or "Just the numbers" (kept on the device). On a computer the steps
are the side panel's Steps tab, with the close-up under the 3D view. The page opens on the steps once building has
started, and the Fold, the PC and a new session all carry on from where the owner left off.
