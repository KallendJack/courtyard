import type { WorkspaceSummary } from "@courtyard/contract";
import { Link, useLocation, useParams } from "@tanstack/react-router";
import { Camera, Keyboard, LogOut, Mic, Plus, Settings, Sparkle } from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  type Ref,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { classes } from "@/lib/classes";
import { addStylesheet } from "@/lib/stylesheet";
import { LiveUpdate } from "../live-update.tsx";
import { Button } from "./button.tsx";
import { CourtyardMark } from "./courtyard-mark.tsx";
import type { Layout, MessageBox } from "./handheld.ts";
import css from "./handheld-frame.css?inline";
import { RecentSessions } from "./recent-sessions.tsx";
import { Sheet } from "./sheet.tsx";
import { WorkspaceDot } from "./workspace-colour.tsx";

// The frame's own stylesheet (handheld-frame.css), added once, when a touch screen first shows it.
addStylesheet("handheld-frame", css);

/** The model in a disc on the rail: its initials and numbers, "Sonnet 5" as "S5". */
const initials = (model: string) =>
  model
    .split(/[\s-]+/)
    .map((word) => (/^\d/.test(word) ? word : word.charAt(0).toUpperCase()))
    .join("");

/** The frame's pieces, set on the page so the page keeps clear of them (handheld-frame.css). */
const INSETS = ["--frame-left", "--frame-right", "--frame-bar", "--frame-bottom"] as const;

/**
 * The Handheld frame (#193, Paper boards Handheld · 00, 03, 10, 11), in place of the sidebar on a
 * touch screen. On a tablet or the unfolded Fold: workspace tiles on a thumb rail down the left,
 * Settings and the Skills, Photo and Model buttons on one down the right, and along the bottom
 * Type and the talk strip. On a phone or the folded Fold: tiles across the top, and the buttons
 * in a row above Type and the talk strip. Type and the strip open the page's message box above
 * the bar (voice comes with #79). Loaded only on a touch screen.
 */
export default function HandheldFrame(props: {
  layout: Exclude<Layout, "desktop">;
  workspaces: readonly WorkspaceSummary[];
  onLogOut: () => void;
  /** Where the page's message box goes. */
  dockRef: Ref<HTMLDivElement>;
  /** The page's message box, when it has one. */
  box: MessageBox | undefined;
  boxOpen: boolean;
  setBoxOpen: (open: boolean) => void;
}) {
  const { layout, box, boxOpen, setBoxOpen } = props;
  const tablet = layout === "tablet";
  const { workspaceId } = useParams({ strict: false });
  const { pathname } = useLocation();
  const here = props.workspaces.find((workspace) => workspace.id === workspaceId);
  const [sheet, setSheet] = useState<"settings" | "recent">();
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  // The page keeps clear of the rails and the bottom bar, and of the message box when it's open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the pieces to measure change with the layout
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    const measure = () => {
      const [l, r, b, all] = [left, right, bar, bottom].map((piece) => piece.current);
      root.setProperty("--frame-left", `${l?.offsetWidth ?? 0}px`);
      root.setProperty("--frame-right", `${r?.offsetWidth ?? 0}px`);
      root.setProperty("--frame-bar", `${b?.offsetHeight ?? 0}px`);
      root.setProperty("--frame-bottom", `${all?.offsetHeight ?? 0}px`);
    };
    const observer = new ResizeObserver(measure);
    for (const piece of [left, right, bar, bottom]) {
      if (piece.current) observer.observe(piece.current);
    }
    measure();
    return () => {
      observer.disconnect();
      for (const inset of INSETS) root.removeProperty(inset);
    };
  }, [layout]);

  // The box closes when the owner taps away from it (the page, say), and it and any sheet when they
  // go to another page.
  useEffect(() => {
    if (!boxOpen) return;
    const away = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-handheld], [data-frame-bottom], dialog")) return;
      setBoxOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [boxOpen, setBoxOpen]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a move to another page is the trigger
  useEffect(() => {
    setBoxOpen(false);
    setSheet(undefined);
  }, [pathname, setBoxOpen]);

  /** Opens the box with the keyboard in it, while the tap is still the browser's to act on. */
  const type = () => {
    if (box === undefined) return;
    flushSync(() => setBoxOpen(true));
    box.focus();
  };

  const tile = (workspace: WorkspaceSummary) => (
    <Tile
      key={workspace.id}
      workspace={workspace}
      look={tablet ? "rail" : "row"}
      open={workspace.id === workspaceId}
      showRecent={() => setSheet("recent")}
    />
  );
  const planning = props.workspaces.filter((workspace) => workspace.mode !== "code");
  const code = props.workspaces.filter((workspace) => workspace.mode === "code");
  const newWorkspace = (
    <Link
      to="/new-workspace"
      aria-label="New workspace"
      className={
        tablet
          ? "flex h-18 w-20 shrink-0 flex-col items-center justify-center gap-1.5 rounded-[20px] px-1.5 text-center text-[12px]/[15px] font-semibold text-muted-foreground data-[status=active]:bg-muted data-[status=active]:text-foreground"
          : "flex size-13 shrink-0 items-center justify-center rounded-lg text-muted-foreground data-[status=active]:bg-muted data-[status=active]:text-foreground"
      }
    >
      <Plus aria-hidden className="size-5" />
      {tablet && "New workspace"}
    </Link>
  );
  const home = (
    <Link
      to="/"
      aria-label="Home"
      className={classes(
        "flex shrink-0 items-center justify-center",
        tablet ? "size-12 rounded-row" : "size-13 rounded-lg bg-muted/60",
      )}
    >
      <CourtyardMark size={tablet ? 34 : 28} />
    </Link>
  );
  const settings = (
    <button
      type="button"
      aria-label="Settings"
      aria-haspopup="dialog"
      onClick={() => setSheet("settings")}
      className={classes(
        "flex shrink-0 items-center justify-center bg-muted/60 text-foreground/70 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px [&_svg]:size-5",
        tablet ? "size-12 rounded-full" : "size-13 rounded-lg",
      )}
    >
      <Settings aria-hidden strokeWidth={1.7} />
    </button>
  );
  const actions = (
    <>
      <QuickAction
        look={tablet ? "disc" : "row"}
        label="Skills"
        disabled={box?.chooseSkill === undefined}
        onClick={() => box?.chooseSkill?.()}
      >
        <Sparkle aria-hidden strokeWidth={1.6} />
      </QuickAction>
      <QuickAction
        look={tablet ? "disc" : "row"}
        label="Photo"
        disabled={box === undefined}
        onClick={() => box?.pickPhotos()}
      >
        <Camera aria-hidden strokeWidth={1.6} />
      </QuickAction>
      <QuickAction
        look={tablet ? "disc" : "row"}
        label="Model"
        {...(box === undefined ? {} : { value: box.model })}
        disabled={box === undefined}
        onClick={() => box?.chooseModel()}
      >
        {box !== undefined && (tablet ? initials(box.model) : box.model)}
      </QuickAction>
    </>
  );

  // Only the frame's own pieces are in its stylesheet's scope: the message box and the sheets keep
  // the theme's classes as they are everywhere else.
  return (
    <>
      <div data-handheld="" className="contents">
        {tablet ? (
          <>
            <nav
              ref={left}
              aria-label="Workspaces"
              className="fixed top-0 bottom-(--frame-bar) left-0 z-20 flex w-[calc(--spacing(28)+env(safe-area-inset-left))] flex-col items-center gap-2.5 overflow-y-auto bg-background pt-4.5 pb-5 pl-[env(safe-area-inset-left)]"
            >
              {home}
              <ul aria-label="Planning workspaces" className="flex flex-col gap-2 pt-1.5">
                {planning.map((workspace) => (
                  <li key={workspace.id}>{tile(workspace)}</li>
                ))}
                <li>{newWorkspace}</li>
              </ul>
              {code.length > 0 && (
                <ul aria-label="Code workspaces" className="flex flex-col gap-2 pt-3">
                  {code.map((workspace) => (
                    <li key={workspace.id}>{tile(workspace)}</li>
                  ))}
                </ul>
              )}
            </nav>
            <div
              ref={right}
              className="fixed top-0 right-0 bottom-(--frame-bar) z-20 flex w-[calc(--spacing(28)+env(safe-area-inset-right))] flex-col items-center gap-3.5 bg-background pt-4.5 pr-[env(safe-area-inset-right)] pb-5"
            >
              {settings}
              <div className="flex-1" />
              <div className="flex flex-col items-center gap-3.5">{actions}</div>
            </div>
          </>
        ) : (
          <header className="flex items-center gap-2 bg-background pt-4 pr-3 pb-3 pl-3">
            <nav
              aria-label="Workspaces"
              className="-my-1 flex min-w-0 flex-1 gap-2 overflow-x-auto py-1 pl-0.5"
            >
              {home}
              {planning.map(tile)}
              {newWorkspace}
              {code.length > 0 && (
                <span aria-hidden className="mx-0.5 w-px shrink-0 self-stretch bg-border" />
              )}
              {code.map(tile)}
            </nav>
            {settings}
          </header>
        )}
      </div>
      <div ref={bottom} data-frame-bottom="">
        <div ref={props.dockRef} data-dock={layout} hidden={!boxOpen} />
        <div data-handheld="" className="contents">
          <div
            ref={bar}
            className={classes(
              "flex bg-background pr-[calc(--spacing(4)+env(safe-area-inset-right))] pb-[calc(--spacing(4)+env(safe-area-inset-bottom))] pl-[calc(--spacing(4)+env(safe-area-inset-left))]",
              tablet ? "items-center gap-3 pt-1.5" : "flex-col gap-2.5 pt-2.5",
            )}
          >
            {!tablet && <div className="flex gap-2">{actions}</div>}
            <div className={classes("flex", tablet ? "flex-1 gap-3" : "h-16 gap-2")}>
              <button
                type="button"
                disabled={box === undefined}
                onClick={type}
                className={classes(
                  "flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-[18px] bg-secondary text-[10px]/3 font-bold tracking-[0.08em] text-muted-foreground uppercase ring-1 ring-input outline-none ring-inset focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:opacity-40 [&_svg]:text-foreground",
                  tablet ? "h-15 w-18 [&_svg]:size-6" : "w-16 [&_svg]:size-5.5",
                )}
              >
                <Keyboard aria-hidden strokeWidth={1.6} />
                Type
              </button>
              <TalkStrip
                wide={tablet}
                where={here?.name ?? (pathname === "/" ? "Home" : "Courtyard")}
                disabled={box === undefined}
                onClick={type}
              />
            </div>
          </div>
        </div>
      </div>

      <Sheet title="Settings" open={sheet === "settings"} onClose={() => setSheet(undefined)}>
        <LiveUpdate />
        <Button variant="outline" onClick={props.onLogOut}>
          <LogOut aria-hidden />
          Log out
        </Button>
      </Sheet>
      {here !== undefined && (
        <Sheet title={here.name} open={sheet === "recent"} onClose={() => setSheet(undefined)}>
          <Link
            to="/workspaces/$workspaceId"
            params={{ workspaceId: here.id }}
            className="text-sm font-semibold text-primary-text underline underline-offset-[3px]"
          >
            Open {here.name}
          </Link>
          <RecentSessions workspaces={props.workspaces} />
        </Sheet>
      )}
    </>
  );
}

/**
 * A workspace's tile: its dot and name, ringed in violet while it's open. A code workspace's has
 * a gold edge (Paper board 03). Tapping the open one again, or holding it, shows its recent
 * sessions.
 */
function Tile(props: {
  workspace: WorkspaceSummary;
  look: "rail" | "row";
  open: boolean;
  showRecent: () => void;
}) {
  const { workspace, open } = props;
  const again = (event: { preventDefault: () => void }) => {
    if (!open) return;
    event.preventDefault();
    props.showRecent();
  };
  return (
    <Link
      to="/workspaces/$workspaceId"
      params={{ workspaceId: workspace.id }}
      aria-label={workspace.name}
      {...(open ? { "aria-haspopup": "dialog" as const } : {})}
      onClick={again}
      onContextMenu={again}
      className={classes(
        "flex shrink-0 items-center justify-center font-semibold outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50",
        props.look === "rail"
          ? "h-18 w-20 flex-col gap-2 rounded-[20px] px-1.5 text-center text-[12px]/[15px] [&>span:first-child]:size-3.5"
          : "h-13 gap-2 rounded-lg px-4 text-sm/[18px] whitespace-nowrap",
        open
          ? "bg-muted font-bold text-foreground shadow-[0_0_22px] shadow-primary/40 ring-2 ring-primary"
          : workspace.mode === "code"
            ? "bg-warning/5 text-foreground/70 ring-1 ring-warning/35 ring-inset"
            : "bg-muted/60 text-foreground/70",
      )}
    >
      <WorkspaceDot colour={workspace.colour} />
      {workspace.name}
    </Link>
  );
}

/**
 * Skills, Photo or Model: a disc with its name under it on a tablet's right rail, or a button in
 * the row above the bar on the cover screen. Model shows the model it sends with.
 */
function QuickAction({
  look,
  label,
  value,
  children,
  ...props
}: Omit<ComponentProps<"button">, "className" | "aria-label" | "children"> & {
  look: "disc" | "row";
  label: string;
  value?: string;
  children: ReactNode;
}) {
  const name = value === undefined ? label : `${label}: ${value}`;
  return look === "disc" ? (
    <button
      type="button"
      aria-label={name}
      aria-haspopup="dialog"
      className="group flex flex-col items-center gap-1.5 outline-none disabled:opacity-40"
      {...props}
    >
      <span className="flex size-15 items-center justify-center rounded-full bg-secondary text-[15px]/[18px] font-extrabold text-foreground ring-1 ring-input ring-inset group-focus-visible:ring-3 group-focus-visible:ring-ring/50 group-active:translate-y-px [&_svg]:size-5.5">
        {children}
      </span>
      <span className="text-[11px]/3.5 font-bold tracking-[0.06em] text-placeholder uppercase">
        {label}
      </span>
    </button>
  ) : (
    <button
      type="button"
      aria-label={name}
      aria-haspopup="dialog"
      className="flex h-12 min-w-0 flex-1 basis-0 items-center justify-center gap-2 rounded-lg bg-secondary px-2 text-xs/4 font-bold text-foreground/85 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:opacity-40 [&_svg]:size-4.5 [&_svg]:shrink-0"
      {...props}
    >
      {value === undefined ? (
        <>
          {children}
          {label}
        </>
      ) : (
        <span className="truncate font-extrabold">{children}</span>
      )}
    </button>
  );
}

/**
 * The talk strip (Paper board 02, idle): "Tap or hold to talk" over where the owner is, in violet
 * with a light along its top. Until voice comes (#79) a tap opens the message box, as Type does.
 */
function TalkStrip(props: {
  wide: boolean;
  where: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={classes(
        "relative flex min-w-0 flex-1 items-center overflow-clip rounded-[18px] bg-primary/5 text-left ring-1 ring-primary/30 outline-none ring-inset focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:opacity-40",
        props.wide ? "h-15 gap-3.5 pr-6 pl-5" : "gap-3 px-4.5",
      )}
    >
      <span
        aria-hidden
        className="absolute inset-x-4.5 top-0 h-0.5 rounded-[2px] bg-linear-to-r from-transparent via-primary-text to-transparent shadow-[0_0_12px_1px] shadow-primary/70"
      />
      <Mic aria-hidden className="size-6 shrink-0 text-primary-text" strokeWidth={1.8} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={classes(
            "font-extrabold tracking-[-0.01em] text-foreground",
            props.wide ? "text-[17px]/5" : "text-base/5",
          )}
        >
          Tap or hold to talk
        </span>
        <span className="truncate text-xs/[18px] text-muted-foreground">{props.where}</span>
      </span>
      {props.wide && (
        <svg aria-hidden viewBox="0 0 120 28" className="h-7 w-30 shrink-0 fill-primary/25">
          {[
            [11, 6],
            [8, 12],
            [4, 20],
            [9, 10],
            [2, 24],
            [7, 14],
            [10, 8],
            [5, 18],
            [9, 10],
            [6, 16],
            [10, 8],
            [11, 6],
          ].map(([y, height], at) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the bars are fixed, a drawing's parts
            <rect key={at} x={at * 10} y={y} width="4" height={height} rx="2" />
          ))}
        </svg>
      )}
    </button>
  );
}
