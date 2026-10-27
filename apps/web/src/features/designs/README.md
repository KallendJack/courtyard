# designs

A code workspace's Designs tab (#522; Paper, "Tablet · Designs: Live boards, row by row" and "Tablet · Designs: one
board full size"). The worker's side is [`designs/`](../../../../worker/src/features/designs/README.md).

**Example:** you tap Designs, then Agreed, and see "Code workspace" with "Tablet · Designs (#522)"; tapping it opens it
full size, and Cover switches to the same screen's cover board.

- **Uses:** `packages/ui` (`Scroller`, `useKept`, buttons, `SegmentedChoice`'s pills for the pages and devices),
  `lib/when.ts` (`agoWords`).
- **Used by:** `features/code-home/` (the Designs tab).

## Screens

- **The tab** (`designs.tsx`): Live, Agreed and Drafts with their counts, Live first, and how fresh the pictures are
  ("From Paper · just now", or that Paper is closed on the worker machine). Then each row, named by its section with
  its count, its boards at their true shapes, scrolling sideways on its own. A style guide or component sheet shows
  a strip from its top. With no Paper file, Connect Paper opens the Connections sheet.
- **One board full size** (`board-view.tsx`): its row's name, its page and size, Desktop, Tablet and Cover to switch
  to the same screen on another device, the picture to pinch and zoom (`zoom.ts`), and Open in Paper ›.

## How it works

- Kept fresh the shared way, every 3 seconds while Paper is exporting. Its calls are in `api.ts`.
