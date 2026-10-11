import type { WorkspaceSummary } from "@courtyard/contract";
import { Link, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { Camera, LogOut, Plus, Settings, Sparkle } from "lucide-react";
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
import { FrameButton, modelMark } from "./frame-button.tsx";
import type { Layout, MessageBox } from "./handheld.ts";
import css from "./handheld-frame.css?inline";
import { HandheldSheet } from "./handheld-sheet.tsx";
import { RecentSessions } from "./recent-sessions.tsx";
import { TalkBar } from "./talk-strip.tsx";
import { WorkspaceDot } from "./workspace-colour.tsx";

// The frame's own stylesheet (handheld-frame.css), added once, when a touch screen first shows it.
addStylesheet("handheld-frame", css);

/** The frame's pieces, set on the page so the page keeps clear of them (handheld-frame.css). */
const INSETS = ["--frame-left", "--frame-right", "--frame-bar", "--frame-bottom"] as const;

/**
 * The Handheld frame (#193, Paper boards Handheld · 00, 03, 10, 11), in place of the sidebar on a
 * touch screen. On a tablet or the unfolded Fold: workspace tiles on a thumb rail down the left,
 * Settings and the Skills, Photo and Model buttons on one down the right, and along the bottom
 * Type and the talk strip. On a phone or the folded Fold: tiles across the top, and the buttons
 * in a row above Type and the talk strip. Type opens the page's message box above the bar, and
 * the strip listens (talk-strip.tsx, #79). Loaded only on a touch screen.
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

  // New session, from the recent sessions (#159): the workspace's page, with its box open for it.
  const navigate = useNavigate();
  /** The page a new session starts on, and the box there was before going to it. */
  const arriving = useRef<{ page: string; from: MessageBox | undefined }>(undefined);
  const [focusBox, setFocusBox] = useState(false);
  const newSession = (workspace: WorkspaceSummary) => {
    const page = `/workspaces/${workspace.id}`;
    setSheet(undefined);
    if (pathname === page) {
      setBoxOpen(true);
      setFocusBox(true);
      return;
    }
    arriving.current = { page, from: box };
    void navigate({ to: "/workspaces/$workspaceId", params: { workspaceId: workspace.id } });
  };
  // Once there, and its page has offered its own box, the box opens.
  useEffect(() => {
    const wanted = arriving.current;
    if (wanted === undefined || pathname !== wanted.page) return;
    if (box === undefined || box === wanted.from) return;
    arriving.current = undefined;
    setBoxOpen(true);
    setFocusBox(true);
  }, [pathname, box, setBoxOpen]);
  useEffect(() => {
    if (!focusBox || !boxOpen || box === undefined) return;
    setFocusBox(false);
    box.focus();
  }, [focusBox, boxOpen, box]);

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
          ? "flex h-18 w-20 shrink-0 flex-col items-center justify-center gap-1.5 rounded-tile px-1.5 text-center text-[12px]/[15px] font-semibold text-muted-foreground data-[status=active]:bg-muted data-[status=active]:text-foreground"
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
    <FrameButton
      look={tablet ? "round" : "square"}
      aria-label="Settings"
      aria-haspopup="dialog"
      onClick={() => setSheet("settings")}
    >
      <Settings aria-hidden strokeWidth={1.7} />
    </FrameButton>
  );
  const actions = (
    <>
      <QuickAction
        look={tablet ? "disc" : "row"}
        label="Skills"
        lit={box?.choosing === "skill"}
        disabled={box?.chooseSkill === undefined}
        onClick={() => box?.chooseSkill?.()}
      >
        <Sparkle aria-hidden strokeWidth={1.6} />
      </QuickAction>
      <QuickAction
        look={tablet ? "disc" : "row"}
        label="Photo"
        lit={false}
        disabled={box === undefined}
        onClick={() => box?.pickPhotos()}
      >
        <Camera aria-hidden strokeWidth={1.6} />
      </QuickAction>
      <QuickAction
        look={tablet ? "disc" : "row"}
        label="Model"
        lit={box?.choosing === "model"}
        {...(box === undefined ? {} : { value: box.model })}
        disabled={box === undefined}
        onClick={() => box?.chooseModel()}
      >
        {box !== undefined && (tablet ? modelMark(box.model) : box.model)}
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
              <TalkBar
                wide={tablet}
                where={here?.name ?? (pathname === "/" ? "Home" : "Courtyard")}
                box={box}
                type={type}
              />
            </div>
          </div>
        </div>
      </div>

      <HandheldSheet
        title="Settings"
        open={sheet === "settings"}
        onClose={() => setSheet(undefined)}
        fits="top"
      >
        <LiveUpdate />
        <Button variant="outline" onClick={props.onLogOut}>
          <LogOut aria-hidden />
          Log out
        </Button>
      </HandheldSheet>
      {here !== undefined && (
        <HandheldSheet
          title={here.name}
          open={sheet === "recent"}
          onClose={() => setSheet(undefined)}
          fits="top"
        >
          <Button onClick={() => newSession(here)}>
            <Plus aria-hidden />
            New session
          </Button>
          <Link
            to="/workspaces/$workspaceId"
            params={{ workspaceId: here.id }}
            className="text-sm font-semibold text-primary-text underline underline-offset-[3px]"
          >
            Open {here.name}
          </Link>
          <RecentSessions workspaces={props.workspaces} />
        </HandheldSheet>
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
        // Held, it's the recent sessions, not the browser's preview of the link or a selection.
        "flex shrink-0 items-center justify-center font-semibold outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-3 focus-visible:ring-ring/50",
        props.look === "rail"
          ? "h-18 w-20 flex-col gap-2 rounded-tile px-1.5 text-center text-[12px]/[15px] [&>span:first-child]:size-3.5"
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
  lit,
  children,
  ...props
}: Omit<ComponentProps<"button">, "className" | "aria-label" | "children"> & {
  look: "disc" | "row";
  label: string;
  value?: string;
  /** Its sheet is open: the disc shows lit beside it (Paper board 09). */
  lit: boolean;
  children: ReactNode;
}) {
  const name = value === undefined ? label : `${label}: ${value}`;
  return look === "disc" ? (
    <FrameButton
      look="disc"
      lit={lit}
      caption={label}
      aria-label={name}
      aria-haspopup="dialog"
      {...props}
    >
      {children}
    </FrameButton>
  ) : (
    <FrameButton look="row" aria-label={name} aria-haspopup="dialog" {...props}>
      {value === undefined ? (
        <>
          {children}
          {label}
        </>
      ) : (
        <span className="truncate font-extrabold">{children}</span>
      )}
    </FrameButton>
  );
}
