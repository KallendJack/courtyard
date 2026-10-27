import type { DesignBoard, DesignDevice, DesignRow, WorkspaceId } from "@courtyard/contract";
import { WebButton } from "@courtyard/ui/buttons/web-link.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { ChevronLeft } from "lucide-react";
import { useEffect, useRef } from "react";
import { paperAddress, pictureAddress } from "./api.ts";
import { useZoom } from "./zoom.ts";

/** The devices a row's buttons switch between, left to right, in their words. */
const DEVICES = { desktop: "Desktop", tablet: "Tablet", cover: "Cover" } as const satisfies Partial<
  Record<DesignDevice, string>
>;
type Device = keyof typeof DEVICES;

/** What a board is drawn of, without its device: `Tablet · Home` and `Cover · Home` are one screen. */
const screenOf = (board: DesignBoard) =>
  board.name.replace(/^Built\s*·\s*/, "").replace(/\b(Desktop|Tablet|Cover)\b\s*·?\s*/i, "");

/** The row's board for `device`: the same screen on it when there's one, else its first. */
const boardFor = (row: DesignRow, device: Device, from: DesignBoard) => {
  const on = row.boards.filter((board) => board.device === device);
  return on.find((board) => screenOf(board) === screenOf(from)) ?? on[0];
};

/**
 * One board full size (#522; Paper, "Tablet · Designs: one board full size"): its row's name, its
 * page and true size, buttons to switch between its row's Desktop, Tablet and Cover, the picture
 * to pinch and zoom, how fresh it is, and "Open in Paper ›".
 */
export function BoardView(props: {
  workspaceId: WorkspaceId;
  fileId: string;
  /** The page it's on, in the picker's words. */
  page: string;
  row: DesignRow;
  board: DesignBoard;
  freshness: string;
  onSwitch: (board: DesignBoard) => void;
  onBack: () => void;
}) {
  const { row, board } = props;
  // It opens where its board was tapped, maybe far down the page: its name and back come into view.
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => top.current?.scrollIntoView({ block: "start" }), []);
  const devices = (Object.keys(DEVICES) as Device[]).filter((device) =>
    row.boards.some((each) => each.device === device),
  );
  // A board its row calls by its device alone is its row's screen.
  const title = Object.values(DEVICES).some((word) => word === board.label)
    ? row.area
    : board.label;
  return (
    <div className="mt-4 flex flex-col gap-3 md:min-h-0 md:flex-1">
      <div ref={top} className="flex scroll-mt-6 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={props.onBack}
            aria-label={`Back to ${props.page}`}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground/85 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronLeft aria-hidden className="size-4" />
          </button>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="truncate text-interface font-bold text-foreground">{title}</h2>
            <p className="text-label font-medium text-muted-foreground">
              {props.page} · {Math.round(board.width)} × {Math.round(board.height)}
            </p>
          </div>
        </div>
        {devices.length > 0 && (
          <fieldset aria-label="Devices" className="flex gap-1.5">
            {devices.map((device) => {
              const target = boardFor(row, device, board);
              const chosen = board.device === device;
              return (
                <button
                  key={device}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => target !== undefined && props.onSwitch(target)}
                  className={classes(
                    "flex h-8 items-center rounded-full px-3.25 text-meta outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    chosen
                      ? "border-stroke border-primary-text bg-primary/12 font-bold text-foreground"
                      : "bg-secondary font-semibold text-foreground/85 hover:bg-muted",
                  )}
                >
                  {DEVICES[device]}
                </button>
              );
            })}
          </fieldset>
        )}
      </div>
      {/* Another board opens whole. */}
      <Picture key={board.id} workspaceId={props.workspaceId} board={board} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-label font-medium text-muted-foreground">
          Pinch to zoom · {props.freshness}
        </p>
        <WebButton variant="quietPrimary" size="words" href={paperAddress(props.fileId)}>
          Open in Paper ›
        </WebButton>
      </div>
    </div>
  );
}

/** The board's picture, to pinch and zoom. */
function Picture(props: { workspaceId: WorkspaceId; board: DesignBoard }) {
  const { board } = props;
  const zoom = useZoom();
  return (
    <div
      {...zoom.handlers}
      className={classes(
        "flex h-[45vh] touch-none items-center justify-center overflow-hidden rounded-lg border border-border bg-surface p-2.5 select-none md:h-auto md:min-h-0 md:flex-1",
        zoom.zoomed ? "cursor-grab" : "cursor-zoom-in",
      )}
    >
      <img
        src={pictureAddress(props.workspaceId, board.picture)}
        alt={board.name}
        width={board.width}
        height={board.height}
        draggable={false}
        className="max-h-full max-w-full rounded-md object-contain"
        style={{ aspectRatio: `${board.width} / ${board.height}`, ...zoom.style }}
      />
    </div>
  );
}
