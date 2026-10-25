# tools

Your tools in Fabrication (#707; Paper, 2 · Agreed, "Fabrication · Your tools, first open", tablet and desktop): the
tools the owner has, ticked once and read by every Build. Fabrication owns them; Courtyard keeps them at the owner's
level (ADR 0037).

**Example:** the owner opens their first Build. Your tools comes first, with the garage's hand saw and clamps already
ticked; they say "a Workmate and two clamps", the tiles tick themselves, and Save keeps them with Undo beside it. The
Build opens next, and its Tools panel's Your tools comes back here.

- **Uses:** Fabrication's API through `api/fabrication.ts` (the owner's tools, Save and its Undo, and "Or just say
  it"), and `packages/ui` (buttons, `CapsLabel`, `Scroller`, listening through `frame/speech.ts`).
- **Used by:** the route `routes/tools.tsx`, which a Build's route sends the owner to until tools are saved or skipped
  on this visit, and a Build's Tools panel.

| File | What it is |
|---|---|
| `tools-page.tsx` | The page: the top bar with Skip for now (or Done), what it's for with "Or just say it", the tiles, and Save with its Undo |
| `tiles.tsx` | The common tools in their four groups, a ticked tile's count, Add your own, and which 3D printer |
| `say-it.tsx` | "Or just say it": the words said or typed, ticked by a model for the owner to check |
| `picks.ts` | What's ticked: from the tools saved and the workspaces' tools to move, and each change to it |

**Screens:** tapping a tile ticks or unticks it; a ticked one has + and − for how many, and one small line saying what
Save moves and from where ("F-clamps · from Garage"), or the owner's own name for a saved one. Ticking 3D printer asks for its
make and plate size. Nothing is saved until Save, which is greyed out while the ticks are the tools as saved.
