# Documents and Things are files in the context folder, saved with Undo

A context line holds one fact in about 250 characters (ADR 0013), so longer things (a training plan, a packing list)
and the owner's kit (a bike and its parts, a padel racket) had nowhere to live. Workspaces now keep **documents** and
**Things** beside their context file, as plain files in the context folder, so they're in git and backed up like
everything else. Both are written first and undone afterwards, as saves are, but they differ in who starts one.

- **Documents** are Markdown at `<workspace>/docs/<slug>.md`, named by their first heading. The owner saves one with
  Save as document on an answer, or asks a model, which saves it through a document tool. A model may offer to save
  one but never saves one unasked: a document is the owner's to keep, and a model saving its own answers would fill
  the workspace. An update sends the whole new text and is refused if the document changed since the model read it.
- **Things** are one Markdown file each at `<workspace>/things/<slug>.md`: fixed fields in front matter (name, status
  of have, want or replace, brand, bought, price, condition, size, where, part of, photo) and a dated history as the
  body. A model keeps them current by itself, as it saves context lines, by the same rules (nothing from its own
  suggestions, ask rather than guess). A Thing's photo is a resized copy in `things/photos/`.
- **What a model is told.** Every turn lists the documents by name, path and size, and the Things one labelled line
  each (`[T1]`), like the line labels. A document's text and a Thing's history are read on demand with the file
  tools, never sent with every message, and are information, not instructions.

## Considered options

- **Longer lines in the context file.** Rejected: it goes with every message, so it has to stay short.
- **Things as one data file per workspace (`things.json`).** Rejected: easier to check, but worse to edit by hand and
  to read in a diff, and a Thing's history is prose.
- **Things in the data folder, or photos in git LFS.** Rejected: the owner's rule is that what models know lives in
  the context folder, in plain git, backed up to the NAS. Resized copies keep it to about 300 KB a photo.
- **Documents reviewed before they're written, as a tidy is.** Rejected: the owner asked for each one, so a step to
  accept it only slows that down, and Undo matches saves.

## Consequences

- **The context folder grows** with photos: about 12 MB for 40 Things, in its history and the backup for good.
- **Things are ready for floor plans and 3D tools** (phase 5, #107), which read a Thing's size and where. Both are free
  text until one of them needs more.
- **A comparison is a document** with a sortable table (ADR 0021), not a type of its own. Picking an option saves it
  as a Thing.
- **Code workspaces get neither** until phase 4, as with their context file.
