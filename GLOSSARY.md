# Courtyard

A self-hosted app for planning projects and writing code with AI models, where each area of the owner's life keeps its
own context so nothing has to be re-explained.

## Language

### Parts of an install

**Courtyard**:
One owner's complete install: a worker and a web app.
_Avoid_: hub, platform, system, dashboard

**Owner**:
The one person a Courtyard belongs to, and the only person who can log in to it.
_Avoid_: user, admin, account

**Device login**:
One device's login to Courtyard, kept in a cookie until that device logs out. Each device has its
own, so logging out on one leaves the others logged in.
_Avoid_: session (that's a conversation), token, account

**Worker**:
The part that does all the work: it holds the context folder, runs sessions, talks to providers and checks the owner's
login.
_Avoid_: backend, server, API, compute node

**Feature folder**:
One feature's code, in `features/` in either app, named the same in both where both have it (`features/things/`,
#453). `docs/overview.md` lists them by job, and each has a `README.md` saying what it does (#459).
_Avoid_: area, domain

**Live copy**:
The clone of `main` the everyday Courtyard runs from, separate from any copy it's developed in, and
updated only when the owner chooses (ADR 0011).
_Avoid_: production, prod, deployment, release

**Main's build**:
CI on `main`'s newest commit, shown beside Update; Update waits for it to pass (#249). Its jobs are drawn in
**stages**, from the workflow's own order: jobs that start together share a stage, and a job that `needs:` others
sits in a stage after theirs (#337).
_Avoid_: pipeline (in code and UI text), deploy status

**Web app**:
The part the owner opens in a browser. Static files that show things and call the worker; it does no model work and
stores nothing but the offline copy, on a device that keeps one (ADR 0030).
_Avoid_: frontend, client, UI server

**Offline copy**:
What a device keeps to read while the worker can't be reached (#106, ADR 0030), when the owner turns on Read offline
for that device in Settings: the owner context, each workspace's context file and sessions, and each workspace's 5
latest conversations. The worker decides what's in it; the device keeps it read-only, and wipes it on logging out.
_Avoid_: cache, offline mode, sync, backup

### Context

**Context folder**:
The git repository on the worker machine that holds every workspace and the owner context. Its backup lives on a git
remote the owner chooses.
_Avoid_: knowledge base, vault, RAG store

**Workspace**:
One folder in the context folder, covering one area of the owner's life or one project.
_Avoid_: project, space, room, context (on its own)

**Workspace icon**:
The plain line icon a workspace shows on its tile and beside its name, one of a small fixed set, kept in its
`workspace.json` (#210). Courtyard suggests one from the workspace's name; the owner picks another in the Icon sheet.
_Avoid_: colour, emoji, logo, avatar

**Workspace order**:
The owner's order for the workspaces, the same on every device: one list in `workspace-order.json` at the context
folder's top (#321). Planning workspaces come first, then code ones, each group in that order; a new one goes at the
end of its group. The owner arranges it by holding a workspace on the thumb rail and dragging it.
_Avoid_: sort order, ranking, position, pinning

**Context file**:
A planning workspace's `CONTEXT.md`: its key facts and ideas, which every model reads first. A code
workspace has none (#301): what it knows lives in its repository.
_Avoid_: system prompt, memory, notes

**Intro line**:
The line under a context file's title, above its sections: what the workspace is for. The owner gives it as
**What's it for?** when adding a workspace; left empty, there's none (#300: the starter never writes a hint there,
and an old hint reads as none). Models read it, and Get to know plans its topics from it; the workspace page doesn't
show it. A code workspace keeps its line in its `workspace.json` instead, as its `description` (#301).
_Avoid_: description (except a code workspace's field), summary, purpose

**Owner context**:
`OWNER.md` at the top of the context folder: what's true across the owner's whole life (About me) and how they like
answers (How to answer me). Every model reads it before the workspace's context file, except that a code workspace's
models read only How to answer me (ADR 0010).
_Avoid_: profile, global context, memory, system prompt, about me (that's one of its sections)

**Fact**:
A line in a context file's Facts section: something true now.
_Avoid_: truth, state

**Plan**:
Something the owner has decided to do: a project's step (#603, ADR 0032). Before projects it was a line in a context
file's Plans section, which went: one still in a file is kept as written, with no label, for the **move review**.
_Avoid_: decision, todo, goal

**Idea**:
A line in a context file's Ideas section: something being considered.
_Avoid_: maybe, wish

**Save**:
A model adding, changing or removing one line of a context file or the owner context during a turn, through the
worker. It names its section (fact or idea, or a preference) and is committed at once; the owner undoes or
edits it afterwards (ADR 0013).
_Avoid_: suggestion (that was ADR 0005's tick-first way), memory, update, write

**Place**:
Which file a line is written in: the workspace's context file (`workspace`) or the owner context (`owner`). A save
names its place, and the owner's Edit can move a line from one to the other (ADR 0013).
_Avoid_: target, destination, scope

**Line label**:
The short tag the worker puts before each line when a model reads a context file (`F3`, `P1`, `I2`) or the owner
context (`MF1`, `MP1`, `MI1` for About me, `A1` for How to answer me), so a save can name the line it changes or
removes. Never stored in the file.
_Avoid_: line number, id, index

**Change**:
One committed difference to the context folder: a save, an undo, an edit, a hand edit, a past tidy, a workspace added,
renamed or archived in the app, or a fresh start. The worker makes them one at a time.
_Avoid_: commit (that's how it's kept), revision, update

**Recent changes**:
The list of changes to a workspace's context file or the owner context, newest first, each with Undo, on a page of
its own linked from **What Courtyard knows** (and Settings).
_Avoid_: history, log, activity (that's a model's doing in a session)

**Get to know**:
A house skill only the owner starts, from the Skill picker or a button in **What Courtyard knows** while the
context file has no lines. It plans the topics worth knowing
from the workspace's name, intro line and the owner context, lists them, then asks one question per message, saving
each answer, until the topics are covered or the owner has had enough, and wraps up.
_Avoid_: onboarding, interview, starter, template

**Get to know me**:
Get to know for the owner context, from a button in Settings: the owner's life (where they live and who with,
work, health, plans, how they like answers), saved to the owner context. Its session runs in the first planning
workspace.
_Avoid_: onboarding, profile setup

**Backup**:
The context folder's copy on a git remote the owner chooses, such as a shared folder on a NAS (ADR 0014), pushed
after every change. Settings says when it's behind, and the home page's problem line points there.
_Avoid_: sync, mirror, remote (on its own)

**Fresh start**:
Clearing everything from trying Courtyard out, so it starts as on its first run: every workspace, the owner context
and every session go; the owner's login, sign-ins and remembered usage limits stay. The context folder's history keeps
the old files, and the sessions move to a dated folder in the data folder. Recent changes begin again after it.
_Avoid_: reset, factory reset, wipe

**Document**:
A longer piece of writing kept in a workspace, such as a training plan or a packing list, as Markdown beside the
context file. The owner saves one from an answer, or asks a model to save or update one; a model never saves one
unasked. Every model is told which documents there are and reads one when it helps (ADR 0020). One a Build replaces,
such as an old shopping list for the bench, is **superseded** by it: models never take sizes from it, and the owner
archives it with one tap (#786).
_Avoid_: note, page, file (on its own), artifact

**Floor plan**:
A room drawn top-down and to scale from data a model writes in a `plan` block (#257): its walls in centimetres, doors
and windows, zones, inner walls and the things in it, solid when the owner has them and dashed when they want them,
always seen from the front of the house with the front at the bottom. Courtyard keeps each room's last one as a
document of its own, saved the moment its answer ends (the one document nobody asks to save), so a redraw replaces
it, and Home shows it.
_Avoid_: layout diagram, ASCII plan, map, blueprint

**Thing**:
One item the owner has, wants or means to replace in a workspace, such as a bike, its chain or a padel racket: a card
with a photo, its details and a dated history. A Thing can be part of another. Models keep Things current as they
save context lines, and the owner undoes or edits (ADR 0020). What's next to do about one is a project's step, never
something the Thing holds (#603). Each has a **kind** (ADR 0037): an item (a file that doesn't say), a **space** or a
**tool**; the first time a size is recorded for one it gets a **subject ID**, which it keeps through a rename and
which a record of its size points at.
_Avoid_: item (except as the kind), kit (that's the list of them), gear, asset, part (that's a Thing part of another)

**Upcoming**:
What a Thing holds as coming next in its place (#602, ADR 0032): one replacement, its name, price, shop, link and why,
shown on its card beside what's fitted. A new one of a part that's there is always upcoming on it, never a Thing of
its own. Once it's bought or **fitted** it's swapped in, the old one going to the Thing's history, with Undo.
_Avoid_: next part, planned part, wishlist item, a new Thing for it

**Find a replacement**:
On every Thing the owner has (#602): a session filled in with the Thing and what's fitted, and budgets to tap (or a
budget talked), which the model answers with real options side by side in an **options block**, each with **Pick**,
a pick becoming the Thing's upcoming one.
_Avoid_: shop for, search, compare (that's a table)

**Project**:
What the owner carries on over days and sessions in a planning workspace (#603, ADR 0032), such as turning the garage
into an office: a file with its goal, its **steps**, its **decisions** and a dated history, kept by a model's project
tool with Undo. Its first step not done is **what's next**, which Home lists with **Carry on**.
_Avoid_: task, goal (that's the line saying what it's for), todo list

**Step**:
One thing to do in a project (#710), kept by an ID through a reorder or rename, with who does it: **you** (with what
it takes), **a pro** (work on electrics, gas or a building's structure, with who to get) or **Courtyard** (working
something out, such as a cut plan). A step done stays, ticked. One that needs something known first, such as a size
to measure, is **not ready yet** until it's recorded.
_Avoid_: task, todo, action item

**Decision**:
A choice made for a project, as buying a part is made (#603): the options weighed, the pick and why, kept on the
project under Decisions, never as a step.
_Avoid_: plan, verdict, answer

**Build**:
Something the owner makes, worked out by code (ADR 0036): a template (a framed bench, wall shelving, a printed part)
and its parameters, from which code derives the parts, the **cut plan**, the **buy list** and the build steps. A
project step can own one. The model sets and explains its parameters; it never writes a length or a quantity itself.
A Build becomes a **recipe** (ADR 0039), its templates **starters**.
_Avoid_: design (that's what it looks like), plan (that's a floor plan or a project), cut list (that's one part of it)

**Recipe**:
What a Build is made of, as the model writes it (ADR 0039): its **pieces**, grouped, and the **joints** that hold
them, every size with its source. Code derives the rest: the parts, cut plan, buy list, steps, close-ups and checks.
A new kind of build is a new recipe, never new code. Pocket holes, dowels, glue-only joints, hinges, drawers and
furniture are outside it; asked for one, the model offers the nearest build a recipe can make.
_Avoid_: design, template (that's a starter), parts list (code derives that)

**Piece**:
One thing a recipe is made of (ADR 0039): a **timber member**, a **sheet panel** or a **printed part**. Pieces come in
**groups**: a rectangle frame, a box or carcass, legs, a shelf on rails or cleats, a brace. Each piece the owner
handles is a part, with its letter (A × 4).
_Avoid_: component, member (on its own), board

**Joint**:
How a recipe holds two pieces together (ADR 0039): screws timber into timber (staggered), screws through a sheet into
an edge, an angle bracket, a bolt with its nut and washer, or a printed holder or bracket. Each is checked, drawn
and given its close-up by code.
_Avoid_: connection, fixing (that's the screw or bolt a joint uses)

**Starter**:
A tested recipe a Build starts from and changes (ADR 0039), such as the bench, a box or crate, a freestanding storage
rack, or a stand for a printer or tools. Once its recipe gives exactly its numbers, a template is one.
_Avoid_: template, preset, example (and not Get to know, or a workspace's first files)

**Load class**:
How much a Build carries, as code works it out from the load said in plain words (#771), such as "paint tins" or "a 3D
printer", set conservatively from a sourced table. Its check for sag uses it.
_Avoid_: weight rating, capacity (that's a saw's), load (that's the owner's words)

**Part recipe**:
A printed part as data (#702): a base (box, plate, cylinder or L-bracket) and the features cut into it or raised on it
(holes, slots, pockets sized from an object, fillets, chamfers, lettering). A model fills one; code checks it and makes
the solid. A new shape is a new recipe, never new code. In a Build's recipe, it's a printed part's piece.
_Avoid_: model (that's who fills it in, or the 3D file), script, CAD

**Cut plan**:
How a Build's parts come out of the timber lengths and sheets it's cut from, allowing for each saw cut.
_Avoid_: cutting list, cut sheet

**Buy list**:
What a Build needs bought: each item, how many, its price and where it's sold, from the Build's parts and fixings,
less what Your stock has: "N things left". **Have it** on a line saves it to Your stock (#760).
_Avoid_: shopping list, BOM, wanted list (that's Things the owner wants)

**Your stock**:
What the owner has for making besides their tools (#760): materials (timber, sheets, filament) and fixings (a screw
case's sizes and counts, castors), Things of kind material or fixing kept at the owner's level, so every Build's buy
list leaves off what it covers, buying only the shortfall, and its steps say where each fixing comes from ("from
your Diall case").
_Avoid_: inventory, materials list, spares

**Build steps**:
A Build's instruction manual in Fabrication (#699), worked out by code from its parameters and the tools to hand
(Your tools, once saved): one step at a time, a **checklist** of one action a line ("show me how" for a beginner, or
"just the numbers"), a close-up with its sizes and screw positions, a check **before you move on**, and the step's
**picture** (#754): the job in 3D as it's done (the length in the Workmate, an end frame on the floor, the frame so
far), with marks drawn from the Build's numbers. A move a beginner may never have made gets a **walk-through** in
"show me how" the first time it comes up (#777): marking as tape, tick, square and line, or marking a joint's screw
spots by eye (#789). The castor step shows its holes drilled through the plate and its bolt's head held while the
nut turns (#783). **Close-ups by type** (#813) are drawn by code for any Build from the pieces they join and their
sizes, their labels 2-3 word pills: a **fixing** type (an angle bracket in a corner, a bolt through a plate, a
screwed overlap) on every step that makes one, and a **technique** (measure and mark a length, driving a screw) in
full the first time the steps use it, a "How?" tap after. Each step is the **simplest way first** (#789): it
opens with how to **batch** it ("One joint at a time"), has at most four lines, measures only what decides how it
turns out and says "by eye" for the rest, drills a pilot hole only where the wood would split, and keeps extras as
**tips** behind a tap. A step that can be done more than one **way** (a hand saw, a circular saw, a
mitre saw) uses the best to hand, and says so in a line when that's changed. A saw's **cutting capacity** (how wide
and deep it cuts at 90°, the size line on the owner's tool) decides which cuts it takes: one too big for it goes to a
saw that takes it, the step saying why in one line (#780).
Its **progress**, the step reached and the lines ticked, is kept on the Build for every device and session, each
step by its ID ("fit-castors") rather than its number, so ticks stay put when a step before comes or goes; a step
started keeps the way it was started, so its ticks stay on the lines they were ticked on.
_Avoid_: instructions (that's what a model is given), tasks, project steps (those are a project's)

**Stock options**:
The timbers or sheets a Build's stock could be instead (#704), such as CLS or treated timber for the frame, or OSB or
MDF for the top: the recommended first, each costed for this Build, with what it's like and what to know. **Pick**
swaps one in every part cut from that stock, and the Build is worked out again. A stock wrong for its parts (MDF in a
damp garage) is a making-rule finding.
_Avoid_: materials, alternatives, variants

**Sourced size**:
A size as a Build takes it (#696): a number, its unit and its source, `measured`, `specified` (with the maker's page
or spec it came from) or `assumed`. Never free text. The sourced Facts of #701 will use the same shape.
_Avoid_: measurement (that's what the owner does), dimension

**Making rules**:
What holds for every Build, as the house rules hold for every repo (ADR 0036): every size says where it came from,
cuts allow for the saw, fixings are checked against what they pass through, the tools needed are checked against the
owner's, and work that needs a pro is said plainly.
_Avoid_: safety rules, build rules

**Size**:
A measurement Courtyard keeps as a record with its source (ADR 0037): what it's of, the value and unit, and whether
it was **measured** (tied to the owner's message), **specified** (a maker's page), **reported** ("about") or
**estimated** (from a photo or a model). Two different values for the same thing are both kept.
_Avoid_: fact (that's a context file line), dimension, measurement (as a record's name)

**Space**:
A Thing of kind space, such as the garage or a van's interior (ADR 0037): its sizes, its openings and what's kept in
it, which the room in Fabrication is drawn from. Spaces are Fabrication's, kept outside any workspace once its own
store lands (ADR 0040, #818).
_Avoid_: room (one kind of space), area, zone (that's a part of a space to keep clear)

**Tool**:
A Thing of kind tool, kept at the owner's level so every project sees it (ADR 0037); a Build's steps use the tools to
hand.
_Avoid_: kit, equipment, hardware

**Your tools**:
The page in Fabrication where the owner ticks the tools they have, once, for every Build (#707): common tools as
tiles in four groups, their own added by name, or **Or just say it** for a model to tick them. It comes before the
first Build and from any Build's Tools. A workspace's Thing that looks like a tool comes ticked, saying what it is and
where from ("F-clamps · from Garage"), and moves to the owner's tools with Save, keeping its name; Save has Undo.
_Avoid_: toolbox, tool list, inventory

**Your stock**:
The materials and fixings the owner has, kept in Fabrication at the owner's level beside Your tools (ADR 0040, #760),
so a Build's buy list shows only what's left to buy.
_Avoid_: inventory, materials list, leftovers

**At the shop**:
Fabrication's shop trip for a Build (ADR 0040, #757): what's left to buy, the swaps when something isn't on the shelf,
and the cutting card for the shop's saw.
_Avoid_: shopping mode, shopping list (that's the buy list)

**Fabrication**:
The app for making (`apps/fabrication`, ADRs 0036, 0040): its spaces, projects and Builds, each Build's chat, 3D view
and build list, Your tools, Your stock and At the shop. It stands on its own, with its own Home, data and sign-in;
Courtyard links in with **Open in Fabrication** and keeps no copy. The engine behind it is `packages/fabrication`.
_Avoid_: Fabricator, maker mode, workshop

**At the bench**:
Fabrication's way of working on a Build while making it (#753): one step fills the screen, read at arm's length, with
the step in 3D beside it, Back and Done at thumb height and a swipe between steps. Under the step's lines, its four
buttons (#793): Show me how, Is this right?, I don't have… and Can't do this now; there is no chat at the bench. Where
a Build with steps opens on the Fold; folded, the only way. Its other way is **Plan**, for planning at a desk: the
Build big in 3D with its cut plan, buy list and tools beside it, and the full chat. On a computer, the three panels
show both.
_Avoid_: step mode, workshop mode, focus mode

**Hold to ask**:
The chat behind one button, at the bench (#753): held, it listens, and let go, what was said is asked in the Build's
chat about the step, its answer a card over the picture with what was asked and ×, until it gets out of the way; the
step never changes (#793). A pause doesn't end it; let go on a few words, it waits a moment for more (#787). A tap
opens the chat, in Plan.
_Avoid_: push to talk (that's the Talk key's), voice chat

**Parked (a step)**:
A Build's step the owner can't do now, kept with why ("Out of time", "Missing: 10 mm spanner × 2"), from Can't do this
now or I don't have… at the bench (#793). The next step not done or parked comes up instead; back on it, it says why,
with Do it now.
_Avoid_: skipped, deferred, on hold

**Carry on (a project)**:
Starting a session from a project, on Home or its page (#603): its first message the project and what's next, and the
session **belongs to** the project, so each of its turns is given the project whole. A model can also attach a
session that's clearly about one.
_Avoid_: resume, open, continue (that's after a restart)

**Wanted list**:
A planning workspace's Things wanted or to replace (#245): Things like any other, with the status Want or Replace,
added by a model, by the owner, or from a product named in an answer (+ Add to wanted). Its picks, price checks and
blocked shops are gone (#600); a buying decision starts from the part instead (ADR 0032).
_Avoid_: shopping list, basket, cart, recommendations, deals

**Main subject**:
What a planning workspace's Home leads with (#603), decided by the worker from its data: a Thing drawn as its kind of
thing, or a space's floor plan (#257), or, until a space has one, **Draw the garage** (#604): a workspace whose facts
give a floor's two sides is a space, and its card shows its size and the facts that measure it, with a button named
from the workspace that starts a session with them, for a floor plan. The **drawn bike** is Courtyard's own drawing of a mountain bike, never a
model's, the Thing's parts placed on it by name, each a label opening its card, one with an upcoming replacement
saying so ("Pedals · DMR V8 next"), and those it has no place for listed under it. The Thing's photo is on its card.
_Avoid_: view, Breakdown view, hero, dashboard

**Planning workspace**:
A workspace whose files models may read but not change.
_Avoid_: read-only workspace, chat workspace

**Code workspace**:
A workspace tied to a git repository on the worker machine, where a provider that can code may edit files and run
commands. It has no context file (#301): its name, its line and its connections are in its `workspace.json`.
_Avoid_: dev workspace, repo workspace

**Home page**:
The page the Courtyard mark opens (#102): the workspaces, a tile each with one line (what waits on the owner, else
when it was last used), and New workspace. At its foot, only when needed, main's build with Update (after an Update,
**What's new** first) and the **problem line**, one gold line for the worst thing wrong, with Fix it. Everything
else is in Settings.
_Avoid_: dashboard, launcher, Home (that's a workspace page's first tab)

**Settings**:
The page with the owner context, the backup when it needs the owner, the sign-ins and Connections, Fresh start and
logging out every other device (#102): from the Handheld frame's Settings sheet (All settings).
_Avoid_: preferences, account, profile

**Home**:
A workspace page's first tab (#300, #301). A code workspace's tabs are Home · Roadmap · Sessions · PRs: Roadmap
always, Sessions once it has some, and PRs keeping its place until it's known to have some (#503, #532). A planning
workspace's are pills, + New · History · Things · Docs, each once it has something. Each tab has its count. A code
workspace's Home shows, in a fixed order, the **Builders
board**, **Needs you**, **Next up** and **Main** (its repository's newest main commit with its build), the first three
keeping their place when empty with one quiet line ("Nothing needs you"), then the message box; from a tablet up it fits the
screen, a block with more rows than fit scrolling inside its card. A planning workspace's Home shows its **main
subject**, then its projects, then the message box, which starts a new session (#603). With no subject it shows its
projects, or one quiet line; an empty workspace only its name, one line and the box.
_Avoid_: dashboard, overview, landing page

**What Courtyard knows**:
A planning workspace's facts and ideas (each line with Fix, which starts a session on it), Recent changes and its
skills (#300), in Home's place, opened first from the workspace's ⋯ (#481). Read from the device's copy, where there's
no ⋯, it's one row on Home.
_Avoid_: context file (that's the file it reads), memory, knowledge base

**Needs you**:
The block on a code workspace's Home of everything else waiting on the owner (AGENTS.md): approvals, failing checks,
new replies, pull requests ready to merge, conflicts, and the setup check's offer, each a row with its one-tap action
(Approve, Review, Open, Merge, Bring up to date). A Lead's builder that waits on the owner shows on the **Builders
board** instead, and Needs you says "Nothing else needs you" (#592). Home's Needs you lists every workspace's,
builders too, whose **Allow** and **Retry** act in place and whose **Review** opens the pull request.
_Avoid_: inbox, notifications, to-do, alerts

**Builders board**:
The block at the top of a code workspace's Home (#592, ADR 0031): everything the Lead and its builders are doing, in
the eight **builder statuses**. Its header says how many build of how many may and how many pull requests wait for
review of the 4 that hold it back ("2 of 2 building · 1 of 4 for review"), then every reason it starts no more at once
("Not starting more: the usage limit, until 18:10 · Pin to Home waits for Journey book to merge"), with Pause or Run,
and Merge in order once more than one is ready. Then a row per builder: its issue's name, its status and since when
("Checking · 2 min"), what it's doing now, and one action only when it acts: **Allow** (or **Answer**, Waiting on
you), **Review** (Ready for review), **Retry** (Stuck); a row that's only working opens its session. A merged one
leaves at the end of the day. The owner's own sessions aren't on it: they're in Sessions.
_Avoid_: Running, Lead row, dashboard, queue

**Merge in order**:
The Lead's one tap for its builders' pull requests ready to merge (#423): it merges them one at a time in the
build order's order, bringing one up to date through its session when it conflicts and waiting for its checks,
and stops at a failing check or a refusal, saying which and why. The tap covers only the ones ready then.
_Avoid_: merge queue, merge all, auto-merge

**Version bump**:
A pull request Dependabot opens to move a dependency on (#84). The worker looks after one whose check fails (#496): it
re-runs the failed jobs once per commit, files a passing re-run as **Flaky e2e** (last in the build order) and a
failing one as **Bump fails** (first, one per bump) for the Lead, asks Dependabot to rebase once that fix merges, and
hands one still failing after it to the owner. A green one waits in Needs you for Merge; it never merges itself.
_Avoid_: dependency update, upgrade, Dependabot PR (in the UI, "From Dependabot")

**Waits for a merge**:
A ready issue the Lead doesn't start yet because a builder still at work is changing the code files it names
(#423); it starts once that builder's pull request merges. Next up and the Builders board say "Next · waits for
<name> to merge" (#592).
_Avoid_: held back, holding back, queued, paused, deferred

**Builder status**:
Where one of the Lead's builders stands, one of eight, each with since when (#590, ADR 0031), recorded by the worker
as things happen in its session: **Building** (the model is working), **Checking** (a check runs, or waits its turn
in the builds lock), **Waiting on you** (an approval, a question it asked, or Continue after a restart), **Waiting
for the limit** (until its reset), **In CI** (its pull request's checks run), **Ready for review**, **Merged**, and
**Stuck** (Courtyard gave up, saying why). A failing check is Building again. A turn that ends with no pull request
and no question is told once to **carry on**; ending so again, it's Stuck. One at the limit carries on at the
reset, and one a restart cut off carries on by itself once (cut off again, it's Stuck). A Stuck one waits on the
Builders board and in Home's Needs you, saying why, its slot free, until the owner taps **Retry** (#592), which
starts it afresh. Only these eight words name where a builder stands, on every screen.
_Avoid_: state, phase, health, stalled, hung, idle, resting, held back

**Roadmap**:
A code workspace's tab of the whole plan (#532): every open milestone in the roadmap's order, Later last, with its
progress, the current one open; inside, its issues in its Build order, each in one plain state: **Building**,
**Ready**, **To grill**, **After** a blocker, or **Done**. Read-only.

**Next up**:
The block on a code workspace's Home, under Needs you, that starts the next of its repository's
`ready-for-agent` issues nobody has claimed, in milestone order (#301), and nothing more (#532): the first has
**Build** (#298): one tap shows the issue and the model, a second starts a session on it and claims the issue on
GitHub. It also counts every issue that isn't ready yet (`needs-triage` or `needs-info`, #463), in its place; a
milestone's Build order line only orders them. **Grill** takes the top in gold on the first of them (#363): it starts
a session with the grilling skill on that issue, which ends with it marked ready; the first ready issue sits under it
with a small Build. A grill claims nothing and takes no builder's place. A ready issue blocked by an open
one (GitHub's blocked by) gets no Build until that closes (#377). Under the cards, one faint **Then** line names the
next few titles, and **Whole roadmap · N more** opens the **Roadmap**. A planning workspace has none: its Home is its
main subject and its projects (#603).
_Avoid_: backlog, queue, roadmap (that's the milestones)

**Connections line**:
The quiet line under a code workspace's name that says its GitHub repo and its Paper file, and opens its
**Connections sheet** (#308): GitHub, and the one Paper file to pick or make (ADR 0023), with one Connect.
_Avoid_: chips, integrations bar, settings

### Models

**Provider**:
A source of models the worker can reach on the owner's own subscription, such as Claude or Codex.
_Avoid_: backend, LLM, vendor, engine, model connection

**Model**:
One specific model offered by a provider.

**Effort**:
How much a model thinks before it answers: one of the levels its provider offers for that model, or the model's
default. Chosen beside the model, recorded with each message, and followed by the session until the owner changes it.
_Avoid_: thinking, reasoning, mode, speed

**Codex home**:
The folder in the data folder where Courtyard's Codex keeps its sign-in, and nothing else: separate from any Codex the
owner uses elsewhere on the machine (ADR 0015).
_Avoid_: Codex config, profile, ~/.codex

**Sign-in**:
A provider's own login, for a provider whose sign-in Courtyard handles (Codex's): started from Settings with a
link and a one-time code to finish on any device, and kept in the provider's own home. Courtyard sees only the link
and code. The owner can say Not now to it (ADR 0015).
_Avoid_: device login (that's the owner's login to Courtyard), token, credentials

**Connections**:
The list in Settings of what Courtyard is signed in to: each provider, and GitHub, with Sign in
and Sign out. A code workspace's own connections (its GitHub repo and Paper file) are in its Connections sheet,
from its connections line (#308).
_Avoid_: integrations, accounts, models list

**GitHub sign-in**:
Courtyard's own sign-in to GitHub, through a GitHub App the owner registered and installed on the repos code
sessions may reach: started from Connections with a device code, kept in the data folder, and given only to a code
session's `git` and `gh`, never the worker machine's own login (#99).
_Avoid_: GitHub token, GitHub account, OAuth app

**Usage limit**:
The point at which a provider stops answering until a reset time, under the owner's subscription. The worker remembers
it until then, and the model picker shows it.
_Avoid_: quota, rate limit (except for the failure reason)

**Skill**:
A folder of instructions a model loads when it needs them, such as grilling a plan, in the open Agent Skills format.
The owner starts one from a button or the skill picker, or by beginning a message with its name (`/implement 157`),
or a model loads one when its description fits. Courtyard loads them itself, never a provider's own skills (ADR 0016),
apart from Matt Pocock's skills in a code workspace. Once started or loaded, a skill stays in use for the rest of its
session. Each comes from one of five places, its **source**: the owner's for one workspace (Yours), a code
workspace's project, the owner's for every workspace (Yours, everywhere), Matt Pocock's, or a house skill.
_Avoid_: prompt, plugin, command, agent

**Skill picker**:
The Skills sheet: a workspace's skills, opened from the frame's Skills or a `/` in the empty Reply box, which
narrows it as the owner types. A picked skill sits in the box as a tag and goes with the message. Of Matt Pocock's skills it lists
only those the owner starts.
_Avoid_: slash command, skill menu

**Matt Pocock's skills**:
The house process's skills (ADR 0018), which every code workspace gets from Courtyard's **pinned copy** of his
plugin: the release `packages/skills/matt.json` names, fetched into the data folder and loaded by Claude Code itself
only when it matches the pin's checksum (ADR 0024). His grilling replaces the house one there.
_Avoid_: the plugin, Matt's plugin (for the copy), installed skills

**House standard**:
What every code workspace's repository has, adding one or creating one (#323, #391): Matt's setup with the house
answers (GitHub issues with the triage labels, `GLOSSARY.md` and `docs/adr/`, `docs/agents/`, the Agent skills
section in its `AGENTS.md` or `CLAUDE.md`), a first milestone with a `Build order:` line, and a Paper file with its
four pages. Optional: without it, sessions follow the repository's own instructions.

**New repo**:
New workspace → Code's way to start a project (#391): a GitHub repo made on the owner's account on the house
standard, its name from what it's for, with a code workspace on it whose Next up offers Grill on its first idea.
No stack: that grill picks it.
_Avoid_: template, scaffold

**Setup check**:
What a code workspace's page offers, once, when its repository isn't on the house standard: a row of Needs you that
opens the **setup card**, one line for each thing it found (its own tracker: Keep or Move to GitHub issues; its
glossary under another name: Rename to `GLOSSARY.md` or Keep; the files and section added; a Paper file: Create or
Skip), the standard recommended on each, unless the repository says another agent writes its tracker. One Set up
opens a pull request.
_Avoid_: onboarding, setup wizard

**House skill**:
A skill that comes with Courtyard, in the `@courtyard/skills` package. The owner's own skills, and a project's, with
the same name replace it (ADR 0016).
_Avoid_: built-in skill, default skill

**Grilling**:
A house skill: a model stress-tests a plan or an idea one question at a time, recommending an answer with each, saves
each decision as the owner agrees it, and ends with a wrap-up of the decisions and the questions still open.
_Avoid_: interview, review, critique

**Move review**:
Once, a planning workspace's moves into what it keeps now (#603, ADR 0032): its guides to projects or one screen, its
Plans and Ideas lines to projects' steps, a done guide to the archive, wanted Things onto their parts as upcoming.
A model proposes them, Home shows them ticked, and only the ticked ones move, each with Undo.
_Avoid_: migration, tidy (that went with #600), clean-up

**Continue**:
Carrying on a turn a restart cut off (an Update, a crash, the PC restarting): a new turn on the same model, told it was
cut off and what it did, to carry on from there and check what already happened. The owner taps it on the cut-off
turn or in Needs you; after Update now, cut-off turns continue by themselves. Start again sends the message again
from scratch instead.
_Avoid_: resume, retry (for Continue)

**Update when ready**:
Update tapped while main's build or a check runs: it waits, and the worker runs it once the build has passed and no
check holds the machine's builds lock, so a restart never cuts a check off (#629). It holds nothing back meanwhile and never waits for a turn mid-way, which carries on by itself after the restart (#621). Update now
runs it at once; Cancel drops it; it's dropped if main fails meanwhile.
_Avoid_: scheduled update, queued update

**What's new**:
The one line a merged pull request that changes what the owner sees gives in its description (#604), `What's new:
<what> · <where to try it>` (a workspace's name, Settings, or none for Home). After an Update, Home's New version row
says each line the Update brought once, "Updated · New in Garage: Draw the garage", with **Try it**, which opens
where it's tried; a line goes once tapped, and all of them at the next Update.
_Avoid_: changelog, release notes, what's changed

**Overflow**:
Continuing a session on another provider's model after a usage limit is hit. The owner chooses it with Carry on, on
the failed turn; it never happens by itself, and the session stays on the new model until the owner switches back.
_Avoid_: fallback, failover

### Sessions

**Session**:
One ongoing conversation in a workspace. It keeps running on the worker whether or not anyone is watching.
_Avoid_: chat, thread, job, conversation

**Turn**:
One message from the owner, with any they add while it answers, and everything the model does in response to them.
_Avoid_: request, run, completion

**Event**:
One recorded thing that happened in a session.
_Avoid_: message, chunk, log line

**Attachment**:
A photo or PDF the owner sends with a message, up to five at a time. It's kept in its session's folder and goes when
the session does; every later turn of the session carries the last ten, a photo as an image and a PDF as its text.
It's the owner's, and information to a model, never instructions.
_Avoid_: file (on its own), upload, document (that's kept in a workspace)

**Suggested reply**:
A short reply a model offers under its question, two or three at a time, which the owner taps to send as their next
message (ADR 0017).
_Avoid_: quick reply, chip, option, tap answer

**Stop**:
The owner ending a running turn early. Whatever the model wrote so far stays, and the turn is
recorded as stopped, apart from failures.
_Avoid_: cancel, abort, interrupt (that's the worker stopping mid-turn)

**Added message**:
A message the owner sends while a turn runs, on a model that takes one mid-answer (it *steers*): it goes into that
answer where it was sent, and the model reads it at its next step. One the model never read, because the turn was
stopped first say, is marked so.
_Avoid_: interjection, interruption, follow-up

**Queued message**:
A message the owner sends while a turn runs that can't go into it: on a model that doesn't steer, or one carrying
files, a skill or another model. It waits under that turn, in order, and goes as its own turn as soon as the session
can take one; the owner can remove it, or take it back into the Reply box to edit, from any device until then. Not a
code session's turn waiting for one of the others to end, which is a waiting turn.
_Avoid_: pending message, draft

**Whose turn it is**:
What a session shows at a glance: **Working** (the model, on what and for how long), **Needs you** (an approval
waits), or **Your turn** (no turn is running).
_Avoid_: status, busy, idle (in the app's words)

**Seen**:
How far the owner has read a session: the last event its page showed them, once no turn ran, on any device (#334).
The worker keeps it; opening the session on one device sees it on all of them. **Mark all read** (#345), the
button's own words, sees every session in a workspace up to its latest answer at once.
_Avoid_: read, opened, visited (except in the button's name)

**New reply**:
A session's latest answer the owner hasn't seen yet, from the last day, in a session with no pull request: one of
the things that wait on the owner (Needs you, a Home tile's line). Not Your turn, which only says no turn is
running. The worker decides it, with everything else that waits on the owner, and every screen shows what it says.
_Avoid_: unread, notification, new message

**Event log**:
The complete, ordered record of a session's events, which is only ever added to.
_Avoid_: history, transcript

**Session note**:
The few lines a planning session leaves for the next sessions in its workspace (#601, ADR 0032): what was done, what
was decided, and what's next. Written by a cheap model once the session has been quiet for half an hour or another
session starts, and again if it carries on; kept with the session in the data folder, never in the context folder.
Every planning turn gets the workspace's latest five.
_Avoid_: summary, memory, recap, the Lead's notes (its lines in the Lead's chat)

**Rich block**:
A table, chart, diagram or floor plan in an answer or a document that Courtyard draws itself from what the model
wrote, never HTML from a model (ADR 0021).
_Avoid_: artifact, canvas, widget, embed

**Activity**:
An event saying what a model is doing: a file it read, a skill it loaded (or one of the skill's files), a web search
or a page it read, a command it ran, an update to its task list, a tool connection it used.
_Avoid_: tool call, step, trace

**Helper**:
One of a provider's own sub-agents that a code session's model hands part of its job to, working in the session's
worktree under its rules and reporting back before the turn ends, shown as a line of its own (ADR 0027). One that
writes code works on its **own branch** (#395), in a worktree of its own beside the session's, merged back into the
session branch when it finishes ("Merged"), or kept for the session's model to sort when the merge clashes.
_Avoid_: sub-agent, agent, worker (that's Courtyard's other part)

**Task**:
A long command a code session's model starts to run on after its turn (a dev server, a slow test run): the worker
runs it, at most three per session, shows it above the Reply box while it runs, and tells the model when it passes or
fails. Its output stays in the data folder. It ends with its session, or a restart. Not the "task" of Allow all for
this task, which is the session's whole job.
_Avoid_: background command, background job, process

**Preview**:
A code session's running app, looked at from the phone (#183): a task serving a web page, opened beside the chat or in
a tab, through a port of the worker's own behind the owner's login, only while the task runs. Start preview runs the
workspace's preview command as a task of the owner's. The model looks at it with its screenshot tool.
_Avoid_: dev server (that's what serves it), live view, staging

**Web search**:
A model looking things up on the web when a question needs current facts, and reading the pages it finds or a link
the owner sent (ADR 0019): in every workspace, a code session's helpers too, on a provider that searches.
_Avoid_: browsing, research, grounding

**Source**:
A web page an answer used, listed under it, numbered, with its site's name and its title (ADR 0019).
_Avoid_: citation, reference, footnote

**Approval**:
The owner's yes or no to something a model wants to do that could change things: a command outside the command
allowlist, or an action of a tool connection that is not a safe action.
_Avoid_: permission, confirmation, prompt

**Command allowlist**:
The commands a code workspace lets a model run without an approval, routine work inside the worktree among them.
_Avoid_: whitelist, safe commands

**Routine work**:
What a code session does all the time inside its worktree, which never asks: editing, moving and generating its
files (code given on the line included), the repository's check scripts, committing, bringing its branch up to date
and pushing it. Only major actions ask: anything outside the worktree, pushing elsewhere or forcing, deleting a
branch or repository, merging, credentials, publishing, the machine's services (#730).
_Avoid_: safe commands, trivial work

**Coding tools**:
Courtyard's own tools for coding in a code session (run a command, write a file, edit a file), for a provider that
codes through Courtyard rather than its own shell (Codex). Each is asked of the worker, as Claude's are, before it's
done.
_Avoid_: Codex's shell, sandbox

**Allow always**:
An approval's third answer: Allow, and from then on run the same command (by its leading words) without asking, for
this session or for this workspace. Never offered for what must always ask. A workspace's are its **Allowed
commands**, each with Remove.
_Avoid_: don't ask again, trust, auto-approve

**Allow all for this task**:
One code session, for 1, 4 or 12 hours or until its task is done (its PR opens, 12 hours at most), runs commands
off the allowlist and edits setup files without asking, each step marked "ran under Allow all", under a gold strip
with Turn off. What must always ask still does. Turned on from an approval or the session's ⋯, never extended
while on; every Lead's builder starts with it, for its issue, until its pull request merges (#591, #730).
_Avoid_: yolo mode, skip permissions, auto-approve

**Session branch**:
The git branch, checked out in its own folder (a worktree), that holds everything a session changed in a code
workspace. The session pushes it and opens its pull request; once that is merged or closed, the session ends and its
branch is cleared away. A session started on a pull request no session opened works on that pull request's branch
instead.
_Avoid_: feature branch, working branch, task branch

**PR page**:
One pull request's page in a code workspace, for any open one on its repository, whoever opened it: what it
changes, the ask line, and Merge or Bring up to date. Once merged or closed, it folds to one card with what's next.
_Avoid_: review screen, PR view

**Ask line**:
The one-line box on a PR page, with quick asks beside it, that asks the pull request's quick questions.
_Avoid_: composer, chat box (that's the message box)

**Quick questions**:
A small read-only conversation about one pull request on its PR page, outside any session: a model reads the pull
request and changes nothing, and its answers can point at lines in the diff. On a tablet it takes the file list's
place beside the diff; on a phone it's a sheet over it.
_Avoid_: PR chat, review chat

**Fix it in a session**:
The one tap on the ask line that carries a pull request's quick questions over to a session on its branch, the one on
it already or a new one, to make the change they came to. The only way the PR page starts a session besides Bring up
to date.
_Avoid_: hand off, escalate

**Bring up to date**:
The one tap that has a pull request's session merge its base in and fix the conflict, when the pull request conflicts
with it.
_Avoid_: rebase, sync, update branch

**Notification**:
A push message to the owner's devices saying a session needs them or has finished.
_Avoid_: alert, ping

**Notify me**:
What a workspace's notifications tell the owner of, picked from its ⋯: Everything, Only what needs me (an approval,
a failure, a question to answer, a builder Waiting on you or Stuck, the Lead pausing itself) or Nothing. Code workspaces start on Everything,
planning ones on Only what needs me.
_Avoid_: mute, do not disturb, notification level

### Tools

**Tool connection**:
An outside tool (an MCP server) that a workspace lets a model use, such as a design app or a homelab.
_Avoid_: integration, plugin, connector, MCP (on its own)

**Safe action**:
An action of a tool connection that only looks at things, and so runs without an approval. The owner's settings decide
which actions are safe, not the tool's author.
_Avoid_: read-only tool, allowed tool

### On a touch screen

**Handheld frame**:
The app's one frame on every device, by the window's width alone (#193, #197): thumb rails from 600 px wide (a
tablet, the unfolded Fold, a computer), and the cover layout (workspace tiles across the top, buttons in a row above
the bottom bar) below it (a phone, the folded Fold, a narrow window).
_Avoid_: mobile view, tablet mode, shell

**Thumb rail**:
One of the Handheld frame's two columns on a tablet, in reach of a thumb: workspace tiles down the left, and down the
right labelled buttons (Model, Skills, Add, Settings) with the Talk key at its foot (#206).
_Avoid_: sidebar, nav bar, toolbar

**Talk strip**:
The wide bar along the bottom of the Handheld frame on a phone or the folded Fold, beside Type, that listens to the
owner (#79): a tap listens hands-free and a second tap stops, or held it's push to talk. What it hears goes into the
message box as it's heard, for the owner to send (#198).
_Avoid_: mic button, voice bar, push-to-talk button

**Talk key**:
The talk strip's counterpart on a tablet (#206): a tall key in the bottom corner of the right thumb rail that
listens the same way. While it listens, the message box shows ✕, ■ and ↑ under the words.
_Avoid_: mic button, record button

**Dock**:
Where a page's message box goes in the Handheld frame. On a tablet, the Reply box: always there at the foot of the
page, between the thumb rails. On a phone or the folded Fold, just above the bottom bar, shown when the owner taps
Type or what they said waits in it, and gone again once it's sent or they tap away.
_Avoid_: drawer, tray, composer area

**Handheld sheet**:
A panel in the Handheld frame for a few choices (Skills, Model, Settings, a workspace's recent sessions, its icon):
from the right edge beside the right rail on a tablet, from the bottom on a phone.
_Avoid_: modal, drawer, popup
