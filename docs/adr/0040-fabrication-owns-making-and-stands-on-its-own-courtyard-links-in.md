# Fabrication owns making and stands on its own; Courtyard links in

Decided with the owner on 2026-10-25 and 2026-10-26 (#759). Sharpens ADR 0036 (Builds are worked out by code) and
amends ADR 0037 (Fabrication owns its records; Courtyard hosts them): Courtyard no longer hosts Fabrication's records.

The owner, 2026-10-25: "I don't know where the line is between Courtyard and Fabrication… it almost feels like
Fabrication should be completely separate with just a one-button link from a room." Then, 2026-10-26: "planning
workspaces in general don't feel great… feels like Fabrication replaces them… remember Fabrication should be able to
be used independently."

What drew the line:
- On 2026-10-24 the Garage chat did a 30-message shopping job by hand, and the owner's last request ("what's left")
  went unanswered. Fabrication must do that job itself.
- On 2026-10-25 the owner opened the Workbench Build and its chat was Courtyard's project session ("Carry on with
  Split the garage in two: Validate the garage layout, services, wall substrates and storage loads."). "This chat
  should be separate to Courtyard, right?"
- ADR 0037 kept the boundary so Fabrication could be a product, but still had Courtyard host its records, its chat
  and its login.

So:

- **Fabrication owns everything about making,** in its own screens and chat:
  - its spaces (a garage, a house, a van) and their sizes;
  - its projects and Builds: cut plans, buy lists and steps;
  - **Your tools** and **Your stock** (#760), the materials and fixings the owner has;
  - **shop trips** (At the shop, swaps, the cutting card, #757).
- **Fabrication stands on its own.** Someone with no Courtyard can use all of it. Nothing in it needs a Courtyard
  workspace or project.
  - Its own Home (#765), its own data and its own sign-in: `/api/fabrication` checks who is signed in itself, and
    the app never calls Courtyard's routes. On the owner's worker, signing in once still opens both.
  - **A Build's chat is the Build's own** (#817). It starts on the Build ("Workbench: what's next is…"), is told
    Fabrication's conduct and is listed with the Build. It is not a Courtyard project's session.
  - Sizes a Build needs (the gap the bench goes in) are asked in the Build's chat, because sizes are Fabrication's.
- **Stored once.** Fabrication's records are kept by the worker at the owner's level, never inside a workspace's
  folder, and are changed only in Fabrication (#818). There are never two copies of what the owner has: Courtyard reads
  and links, and keeps no copy.
- **Courtyard keeps what isn't making:** life-wide conversations, projects and plans (business, mountain biking, the
  homelab), and household Things that aren't for making. Wall types, services and storage loads stay Courtyard
  planning.
- **Courtyard links in when you have both, never required:**
  - **Open in Fabrication** is one button: on a space (the garage), and on a project step with a Build. It lands on
    that space or Build in Fabrication.
  - A life plan's step can point at a Fabrication Build, and the switcher (#814) jumps between the apps.
  - Courtyard's planning chat hands making work over ("open it in Fabrication") instead of doing cut or shopping lists
    itself (`docs/ai-conduct.md`, Making goes to Fabrication).
- **For the owner,** physical spaces live in Fabrication. Courtyard's DIY pieces fold into Fabrication (#716).

## Considered options

- **Keep ADR 0037's hosting** (Fabrication's records in a workspace's folder, Courtyard's sessions as its chat).
  Rejected: the Build's chat carried the project's planning, and a shopping job done in Courtyard's chat went
  unfinished. It also kept Fabrication tied to Courtyard to be used at all.
- **Fabrication as a separate product now,** with its own worker and accounts. Rejected for now: one worker serving
  both keeps one login, one backup and one model setup for the owner. Selling stays ADR 0036's later decision.
- **A copy of the garage in each app.** Rejected: two copies drift. Courtyard links to Fabrication's one record.

## Consequences

- **Follow-up slices:** a Build's own chat and the planning hand-over (#817); Fabrication's own store, with the
  workspace's Builds and spaces moved once with a tap and Courtyard's steps keeping a link (#818); Fabrication Home
  (#765); Your stock (#760); At the shop (#757); then stripping back Courtyard's DIY pieces (#716).
- **Courtyard's planning sessions lose the Build and size tools** once Fabrication's chat has them (#716). Until then
  they keep them, and the hand-over rule is told once #817 lands.
- **Evals check the hand-over:** asked in a planning workspace for a shopping list for a Build, the model points to
  Fabrication and writes no list.
- **The glossary** gains Your stock and At the shop, and Fabrication's entry says it stands on its own.
