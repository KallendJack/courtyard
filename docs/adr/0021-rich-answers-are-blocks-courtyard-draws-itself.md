# Rich answers are blocks Courtyard draws itself

The Claude app and ChatGPT answer with charts, diagrams, sortable tables and small pages of their own. Courtyard's
answers are untrusted, so the web app turns their Markdown into elements and never shows HTML from a model
(`answer.tsx`). Rich answers keep that: a model writes data or a description in a fenced block, and Courtyard draws
it with its own code, the same for every provider.

- **Tables.** Every Markdown table can be sorted by a column. No new syntax.
- **Charts.** A `chart` block holds JSON (a bar, line or pie chart, its labels and series), drawn in the theme's
  colours.
- **Diagrams.** A `mermaid` block holds a Mermaid diagram.
- A block that can't be drawn shows its source with a line saying so; the answer is still fine. Blocks are plain
  Markdown, so a saved document (ADR 0020) keeps them and its page draws them the same way. When a model uses one is a
  rule in `docs/ai-conduct.md`.

## Considered options

- **Sandboxed pages:** a model's HTML in an iframe with no access to the app or the worker. Rejected: the riskiest
  option, whatever the sandbox, and it pulls the app towards pages it can't style or check. Courtyard accepts this gap
  with the Claude app and ChatGPT (#111).
- **SVG from a model, made safe.** Kept for floor plans (phase 5), where a drawing to scale needs it, and not for
  charts or diagrams, which come out more consistent from data.

## Consequences

- **The chart and diagram code loads only when a block is there,** never on the first load. Mermaid is large, so it
  can be swapped for a lighter library if that matters.
- **A new kind of block is a change to the web app and `docs/ai-conduct.md`,** never something a model can invent.
