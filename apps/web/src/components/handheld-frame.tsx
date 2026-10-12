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
import { LiveUpdate } from "../live/live-update.tsx";
import { Button } from "./button.tsx";
import { CourtyardMark } from "./courtyard-mark.tsx";
import { FrameButton, modelMark } from "./frame-button.tsx";
import type { Layout, MessageBox, TalkTarget } from "./handheld.ts";
import css from "./handheld-frame.css?inline";
import { HandheldSheet } from "./handheld-sheet.tsx";
import { RecentSessions } from "./recent-sessions.tsx";
import { TalkBar, TalkKey } from "./talk-strip.tsx";
import { WorkspaceIcon } from "./workspace-icon.tsx";

// The frame's own stylesheet (handheld-frame.css), added once, when a touch screen first shows it.
addStylesheet("handheld-frame", css);

/** The frame's pieces, set on the page so the page keeps clear of them (handheld-frame.css). */
const INSETS = ["--frame-left", "--frame-right", "--frame-bar", "--frame-bottom"] as const;

/**
 * The Handheld frame (#193, Paper boards Handheld · 00, 03, 10, 11), in place of the sidebar on a
 * touch screen. On a tablet or the unfolded Fold (#206, the agreed tablet boards): workspace tiles
 * on a thumb rail down the left, and down the right labelled buttons (Model, Skills, Add, and a
 * quieter Settings) with the Talk key in the bottom corner; the page's message box, the Reply box,
 * is always there at the foot of the page between them. On a phone or the folded Fold: tiles
 * across the top, and the buttons in a row above Type and the talk strip, Type opening the
 * message box above the bar. The key and the strip listen (talk-strip.tsx, #79). Loaded only on
 * a touch screen.
 */
export default function HandheldFrame(props: {
  layout: Exclude<Layout, "desktop">;
  workspaces: readonly WorkspaceSummary[];
  onLogOut: () => void;
  /** Where the page's message box goes. */
  dockRef: Ref<HTMLDivElement>;
  /** The page's message box, when it has one. */
  box: MessageBox | undefined;
  /** A field to talk into, on a page without a message box (#264). */
  field: TalkTarget | undefined;
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

  /** Where talking goes: the page's message box, or else the field it offers (#264). */
  const talkTo = box ?? props.field;
  /**
   * Opens the box with the keyboard in it, while the tap is still the browser's to act on; or puts
   * the keyboard in the page's field.
   */
  const type = () => {
    if (box === undefined) return props.field?.focus();
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
          ? "flex h-18 w-20 shrink-0 flex-col items-center justify-center gap-1.5 rounded-tile px-1.5 text-center text-label/3.75 font-semibold text-muted-foreground data-[status=active]:bg-muted data-[status=active]:text-foreground"
          : "flex size-13 shrink-0 items-center justify-center rounded-lg text-muted-foreground data-[status=active]:bg-muted data-[status=active]:text-foreground"
      }
    >
      <Plus aria-hidden className="size-5" />
      {tablet && "New workspace"}
    </Link>
  );
  // On Home, the mark is ringed in violet as an open tile is (#237), so the owner always sees
  // where they are.
  const home = (
    <Link
      to="/"
      aria-label="Home"
      activeOptions={{ exact: true }}
      className={classes(
        "flex shrink-0 items-center justify-center data-[status=active]:bg-muted data-[status=active]:ring-2 data-[status=active]:ring-primary",
        tablet ? "size-12 rounded-row" : "size-13 rounded-lg bg-muted/60",
      )}
    >
      <CourtyardMark size={tablet ? 34 : 28} />
    </Link>
  );
  const settings = (
    <FrameButton
      look={tablet ? "quiet" : "square"}
      aria-label="Settings"
      aria-haspopup="dialog"
      onClick={() => setSheet("settings")}
    >
      <Settings aria-hidden strokeWidth={1.7} />
      {tablet && "Settings"}
    </FrameButton>
  );
  const skills = (
    <QuickAction
      look={tablet ? "rail" : "row"}
      label="Skills"
      lit={box?.choosing === "skill"}
      disabled={box?.chooseSkill === undefined}
      onClick={() => box?.chooseSkill?.()}
    >
      <Sparkle aria-hidden strokeWidth={1.6} />
    </QuickAction>
  );
  // A photo or a file: on a tablet, Add.
  const add = (
    <QuickAction
      look={tablet ? "rail" : "row"}
      label={tablet ? "Add" : "Photo"}
      lit={false}
      disabled={box === undefined}
      onClick={() => box?.pickPhotos()}
    >
      {tablet ? <Plus aria-hidden strokeWidth={1.8} /> : <Camera aria-hidden strokeWidth={1.6} />}
    </QuickAction>
  );
  const model = (
    <QuickAction
      look={tablet ? "rail" : "row"}
      label="Model"
      lit={box?.choosing === "model"}
      {...(box === undefined ? {} : { value: box.model })}
      disabled={box === undefined}
      onClick={() => box?.chooseModel()}
    >
      {box !== undefined && (tablet ? modelMark(box.model) : box.model)}
    </QuickAction>
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
              className="fixed inset-y-0 right-0 z-20 flex w-[calc(--spacing(37.5)+env(safe-area-inset-right))] flex-col gap-3 overflow-y-auto bg-background pt-6 pr-[calc(--spacing(2.5)+env(safe-area-inset-right))] pb-[calc(--spacing(3.75)+env(safe-area-inset-bottom))] pl-2.5"
            >
              {model}
              {skills}
              {add}
              {settings}
              <div className="flex-1" />
              <TalkKey box={talkTo} type={type} />
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
        {/* On a tablet the box is always there, on a page that has one; on the cover screen, once opened. */}
        <div
          ref={props.dockRef}
          data-dock={layout}
          hidden={tablet ? box === undefined : !boxOpen}
        />
        {!tablet && (
          <div data-handheld="" className="contents">
            <div
              ref={bar}
              className="flex flex-col gap-2.5 bg-background pt-2.5 pr-[calc(--spacing(4)+env(safe-area-inset-right))] pb-[calc(--spacing(4)+env(safe-area-inset-bottom))] pl-[calc(--spacing(4)+env(safe-area-inset-left))]"
            >
              <div className="flex gap-2">
                {skills}
                {add}
                {model}
              </div>
              <div className="flex h-16 gap-2">
                <TalkBar
                  where={here?.name ?? (pathname === "/" ? "Home" : "Courtyard")}
                  box={talkTo}
                  type={type}
                />
              </div>
            </div>
          </div>
        )}
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
 * A workspace's tile: its icon and name, ringed in violet while it's open, its icon violet too
 * (Paper board Handheld · 36). Closed, every tile looks the same, a code workspace's too: it's
 * told apart by its icon, never by colour (#237). A tap always goes to the workspace's page, even
 * from one of its sessions (#276); holding the open one shows its recent sessions.
 */
function Tile(props: {
  workspace: WorkspaceSummary;
  look: "rail" | "row";
  open: boolean;
  showRecent: () => void;
}) {
  const { workspace, open } = props;
  const held = (event: { preventDefault: () => void }) => {
    if (!open) return;
    event.preventDefault();
    props.showRecent();
  };
  return (
    <Link
      to="/workspaces/$workspaceId"
      params={{ workspaceId: workspace.id }}
      aria-label={workspace.name}
      onContextMenu={held}
      className={classes(
        // Held, it's the recent sessions, not the browser's preview of the link or a selection.
        "flex shrink-0 items-center justify-center font-semibold outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-3 focus-visible:ring-ring/50",
        props.look === "rail"
          ? "h-18 w-20 flex-col gap-2 rounded-tile px-1.5 text-center text-label/3.75"
          : "h-13 gap-2 rounded-lg px-4 text-sm/4.5 whitespace-nowrap",
        open
          ? "bg-muted font-bold text-foreground shadow-glow-tile ring-2 ring-primary"
          : "bg-muted/60 text-foreground/70",
      )}
    >
      <WorkspaceIcon icon={workspace.icon} size="tile" open={open} />
      {workspace.name}
    </Link>
  );
}

/**
 * Skills, Add (Photo) or Model: a labelled button on a tablet's right rail, or a button in the row
 * above the bar on the cover screen. Model shows the model it sends with: on the rail, its mark.
 */
function QuickAction({
  look,
  label,
  value,
  lit,
  children,
  ...props
}: Omit<ComponentProps<"button">, "className" | "aria-label" | "children"> & {
  look: "rail" | "row";
  label: string;
  value?: string;
  /** Its sheet is open: the button shows lit beside it (Paper board 09). */
  lit: boolean;
  children: ReactNode;
}) {
  const name = value === undefined ? label : `${label}: ${value}`;
  return look === "rail" ? (
    <FrameButton look="rail" lit={lit} aria-label={name} aria-haspopup="dialog" {...props}>
      {value === undefined ? (
        children
      ) : (
        <span className="min-w-5 shrink-0 text-center text-meta font-extrabold">{children}</span>
      )}
      {label}
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
