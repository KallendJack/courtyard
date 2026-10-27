import {
  DESIGN_PAGES,
  type DesignBoard,
  type DesignPageKind,
  type DesignRow,
  type Designs as DesignsAnswer,
  type WorkspaceId,
} from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { SegmentedChoice } from "@courtyard/ui/forms/segmented-choice.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { createKept, PlaceholderRows, useKept } from "@courtyard/ui/layout/kept.tsx";
import { Scroller } from "@courtyard/ui/layout/scroller.tsx";
import { useState } from "react";
import { agoWords } from "@/lib/when";
import { loadDesigns, pictureAddress } from "./api.ts";
import { BoardView } from "./board-view.tsx";

/** Each workspace's designs as last known, for the tab's lifetime. */
const KEPT_DESIGNS = createKept<DesignsAnswer>();

/** How often the tab asks while Paper is exporting, so the pictures show soon after. */
const EXPORTING_EVERY_MS = 3000;

/** The picker's words for each page. */
export const PAGE_NAMES = {
  live: "Live",
  agreed: "Agreed",
  drafts: "Drafts",
} as const satisfies Record<DesignPageKind, string>;

/** How tall a row's pictures are: a screen's row, and a row of style guides and components. */
const SCREEN_HEIGHT = 163;
const SHEET_HEIGHT = 120;
/** The widest a picture in a row may be: a desktop board's, at a screen row's height. */
const WIDEST = 260;

/** Where the pictures come from, and how fresh they are, in a quiet line. */
export const freshnessOf = (designs: DesignsAnswer) => {
  if (designs.exportedAt === null) {
    return designs.exporting
      ? "Asking Paper for its boards…"
      : "Open Paper on the worker machine to see its boards here";
  }
  const age = agoWords(designs.exportedAt);
  if (!designs.reached) return `Last from Paper ${age} · Paper is closed on the worker machine`;
  return designs.exporting ? `From Paper · ${age} · updating` : `From Paper · ${age}`;
};

/** How old a board's picture is, under it full size: "from Paper 4 min ago". */
const sinceOf = (designs: DesignsAnswer) =>
  designs.exportedAt === null
    ? freshnessOf(designs)
    : `${designs.reached ? "from" : "last from"} Paper ${agoWords(designs.exportedAt)}`;

/**
 * A code workspace's Designs tab (#522; Paper, "Tablet · Designs: Live boards, row by row"): its
 * Paper file's boards as pictures, laid out the way the file is. Live, Agreed or Drafts, each with
 * its count, Live first, and how fresh the pictures are; then each page's rows, each named by its
 * section and holding its boards at their true shapes, Desktop, Tablet and Cover left to right. A
 * board tapped opens full size (`BoardView`). With no Paper file, it says how to connect one.
 */
export function Designs(props: {
  workspaceId: WorkspaceId;
  /** The workspace's Paper file: none, or not known yet. */
  paperFileId: string | null | undefined;
  /** Opens the Connections sheet, to connect a Paper file. */
  onConnect: () => void;
}) {
  const { workspaceId } = props;
  const designs = useKept(KEPT_DESIGNS, {
    key: workspaceId,
    asking: typeof props.paperFileId === "string",
    load: async () => {
      const loaded = await loadDesigns(workspaceId);
      return loaded.kind === "loaded" ? loaded.data : undefined;
    },
    busy: (known) => (known.exporting ? EXPORTING_EVERY_MS : undefined),
  });
  const [kind, setKind] = useState<DesignPageKind>("live");
  const [opened, setOpened] = useState<{ row: DesignRow; board: DesignBoard }>();

  if (props.paperFileId === null) {
    return (
      <div className="mt-4 flex flex-col items-start gap-3">
        <p className="text-interface text-foreground/85">
          Designs shows the boards in this workspace's Paper file.
        </p>
        <Button size="sm" onClick={props.onConnect}>
          Connect Paper
        </Button>
      </div>
    );
  }
  const page = designs?.pages.find((each) => each.kind === kind);
  if (designs !== undefined && opened !== undefined) {
    return (
      <BoardView
        workspaceId={workspaceId}
        fileId={designs.fileId}
        page={PAGE_NAMES[kind]}
        row={opened.row}
        board={opened.board}
        freshness={sinceOf(designs)}
        onSwitch={(board) => setOpened({ row: opened.row, board })}
        onBack={() => setOpened(undefined)}
      />
    );
  }
  return (
    <div className="mt-4 flex flex-col gap-3.5 md:min-h-0 md:flex-1">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <SegmentedChoice
          label="Pages"
          look="pills"
          value={kind}
          onChange={setKind}
          options={DESIGN_PAGES.map((each) => {
            const count = designs?.pages.find((one) => one.kind === each)?.count;
            return {
              value: each,
              label: PAGE_NAMES[each],
              ...(count === undefined ? {} : { count }),
            };
          })}
        />
        <p className="text-label font-medium text-muted-foreground">
          {designs === undefined ? " " : freshnessOf(designs)}
        </p>
      </div>
      <Scroller
        from="tablet"
        role="region"
        aria-label={`${PAGE_NAMES[kind]} boards`}
        className="flex flex-col gap-5.5 md:min-h-0 md:flex-1"
      >
        {page === undefined || (page.rows.length === 0 && designs?.exportedAt === null) ? (
          <PlaceholderRows count={3} size="panel" />
        ) : page.rows.length === 0 ? (
          <p className="text-meta text-muted-foreground">{PAGE_NAMES[kind]} has no boards yet</p>
        ) : (
          page.rows.map((row) => (
            <Row
              key={`${row.area}-${row.boards[0]?.id}`}
              workspaceId={workspaceId}
              row={row}
              onOpen={(board) => setOpened({ row, board })}
            />
          ))
        )}
      </Scroller>
    </div>
  );
}

/** One row: its section's name and how many boards, then its boards side by side. */
function Row(props: {
  workspaceId: WorkspaceId;
  row: DesignRow;
  onOpen: (board: DesignBoard) => void;
}) {
  const { row } = props;
  const sheets = row.boards.every((board) => board.device === "other");
  const height = sheets ? SHEET_HEIGHT : SCREEN_HEIGHT;
  return (
    <section aria-label={row.area} className="flex shrink-0 flex-col gap-2.5">
      <div className="flex items-baseline gap-2.5">
        <CapsLabel tone="muted" heading={{}}>
          {row.area}
        </CapsLabel>
        <span className="text-label font-semibold text-placeholder">
          {row.boards.length === 1 ? "1 board" : `${row.boards.length} boards`}
        </span>
      </div>
      <Scroller axis="x" className="flex items-end gap-3 pb-1">
        {row.boards.map((board) => {
          // A sheet taller than it is wide (a style guide) shows a strip from its top, as wide as
          // a desktop board.
          const tall = sheets && board.height > board.width;
          const width = tall
            ? WIDEST
            : Math.round(Math.min(WIDEST, (height * board.width) / board.height));
          return (
            <button
              key={board.id}
              type="button"
              onClick={() => props.onOpen(board)}
              aria-label={`Open ${board.name}`}
              className="flex shrink-0 flex-col gap-1.5 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              style={{ width }}
            >
              <img
                src={pictureAddress(props.workspaceId, board.picture)}
                alt=""
                width={width}
                height={height}
                loading="lazy"
                className="rounded-md border border-border object-cover object-top"
                style={{ width, height }}
              />
              <span className="truncate text-label font-semibold text-foreground/85">
                {board.label}
              </span>
            </button>
          );
        })}
      </Scroller>
    </section>
  );
}
