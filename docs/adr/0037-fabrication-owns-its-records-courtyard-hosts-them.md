# Fabrication owns its records; Courtyard hosts them

Decided with the owner on 2026-10-24, grilling the planning restructure (#701) and the room in 3D (#705). Builds on
ADR 0036 (Builds are worked out by code), and amends ADRs 0020 and 0032 for spaces, tools and measurements.

A planning workspace couldn't tell a measured size from a guess:
- A garage's floor was a sentence in its context file ("approximately 5.137 m"), which Home's `spaceOf` read with a regex.
- Outdoor measurements (71.5, 62, about 140 cm) sat in a project's history lines.
- A floor plan's sizes were whatever the model last drew.

Project steps had no identity, and six of the garage project's ten steps were decisions. Meanwhile Fabrication may one
day be a product for other people, while Courtyard stays the owner's own tool.

So:

- **Fabrication owns its concepts:** a **project**, its **spaces** (a garage, a van), its **Builds**, **sizes with their
  source**, and the owner's **tools**. They are defined in the contract and `packages/fabrication`, not borrowed from
  Courtyard. The Fabrication app talks only to Fabrication's own API in the worker.
- **Courtyard hosts them.**
  - A planning workspace's project (Split the garage in two) is a Fabrication project: its Builds hang off its steps.
  - The workspace holds the spaces, and the owner holds the tools, for every project in it.
  - Its records are files in the context folder, saved with Undo.
  - Courtyard's sessions are the chat Fabrication uses.
  - A standalone Fabrication could implement the same API with its own storage and accounts, and the app wouldn't change.
- **Spaces and tools are kinds of Thing.** The garage is a Thing of kind space. Tools are Things of kind tool, kept at the
  owner's level so every project sees them. A Thing gets a subject ID from the worker the first time a size is
  recorded for it: renaming keeps the ID; deleting and making a new one doesn't. Parts may go deeper than one level.
- **A size is a record with its source:**
  - Each record holds the subject, property, value and unit, and its source: **measured**, **specified** (with the maker's
    page), **reported** ("about"), or **estimated** (from a photo or a model).
  - The worker, not the model, ties "measured" to the owner's message.
  - Two different values for the same thing are both kept and shown, and nothing wins on its own.
  - A correction needs the revision it read.
  - A Build's sizes use the same shape (ADR 0036), and point at these records once they exist.
- **One record, shown everywhere.** A Thing's page in Courtyard has a Sizes section (value, source, tap to correct,
  Undo). Fabrication shows the same records wherever a Build or a room uses them. Old sizes in sentences are offered
  once as a list to confirm with a tap; nothing becomes "measured" without one.
- **Project steps:**
  - Each step has an ID, done or not, and who does it (the owner, a pro, Courtyard).
  - A step can say what it needs (a size, a check), and shows "not ready yet" until that's known.
  - Decisions are kept apart from steps; "decided" is no longer a step kind.
  - The model keeps the steps current.
- **The room lives in Fabrication:**
  - A top-down plan drawn from the space's measured sizes, where Builds and Things are dragged into place (with Undo),
    and a 3D view of the same layout.
  - Keep-clear and clearance zones (the boiler, the door's swing, a walkway) come from Things; a placement in one is a
    making-rule finding.
  - A planning workspace's Home shows a preview that opens it.
  - Starting from a photo comes second, every size from it estimated. A van's interior comes after rooms.

## Considered options

- **Measurements on the Thing's own file.** Rejected: the Thing's front matter is flat text, and a size needs its source,
  revision and history; a separate record keeps both simple.
- **Fabrication built on Courtyard's workspaces directly.** Rejected: it would tie the possible product to the owner's
  own tool. Drawing the boundary now costs a mapping, and saves a rewrite later.
- **A photo as the room's first source.** Not first: photo sizes are estimates, and they'd pass for facts until sizes
  carry their source.

## Consequences

- **Removed as records take over:** `spaceOf` and the bike drawing's name matching, the move review once every workspace
  has moved, and the "decided" step kind.
- **Evals check the saved records,** not the answer's wording:
  - an exact measurement with provenance
  - "about" stays reported
  - a photo gives no measured sizes
  - a conflict is kept
  - correction and Undo
  - reuse in a new session
  - bought isn't fitted
  - code sessions get no Fabrication tools
