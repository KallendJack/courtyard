import type { FrictionPlace } from "@courtyard/contract";
import { useEffect, useRef, useState } from "react";
import { useAction } from "@/hooks/use-action";
import { classes } from "@/lib/classes";
import { fileReport, loadPlace } from "../../features/friction/api.ts";
import { type FilledIn, sizeWords } from "../../features/friction/filled-in.ts";
import { Button } from "../buttons/button.tsx";
import { FormError } from "../forms/form-error.tsx";
import { type Layout, type TalkTarget, useFinePointer } from "../frame/handheld.ts";
import { CapsLabel } from "../layout/caps-label.tsx";
import { createKept, useKept } from "../layout/kept.tsx";
import { describeProblem } from "../layout/problems.tsx";
import { Scroller } from "../layout/scroller.tsx";

/** Where a report goes, as last known, so the sheet opens with it at once. */
const KEPT = createKept<FrictionPlace>();

/** The screen's picture: still being taken, taken, or the browser couldn't draw it. */
type Screen =
  | { readonly kind: "taking" }
  | { readonly kind: "taken"; readonly blob: Blob; readonly url: string }
  | { readonly kind: "failed" };

/**
 * Something's off (#554; Paper, "Tablet · Something's off: what it fills in" and its Desktop and
 * Cover boards): the screen as it was at the tap, what the owner said, and chips for what it
 * filled in, then File it, which starts a session in Courtyard's own code workspace that files the
 * issue. It isn't modal: the Talk key and the talk strip stay live while it's open (on the cover
 * screen it floats above the talk row), and what's said goes into its You said box, which is also
 * there to type in. Rising from the foot of the page, the page dimmed under it. Loaded when it
 * first opens.
 */
export default function FrictionSheet(props: {
  layout: Layout;
  filled: FilledIn;
  /** The screen's picture, being taken as the sheet opens. */
  screen: Promise<Blob | undefined>;
  /** Hands the frame's talking what's said, while the sheet is open. */
  offerTalk: (target: TalkTarget) => () => void;
  onClose: () => void;
}) {
  const { filled, onClose } = props;
  const cover = props.layout === "cover";
  const fine = useFinePointer();
  const ref = useRef<HTMLDialogElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const [said, setSaid] = useState("");
  const saidNow = useRef(said);
  saidNow.current = said;
  const [screen, setScreen] = useState<Screen>({ kind: "taking" });
  const place = useKept(KEPT, {
    key: "place",
    asking: true,
    load: async () => {
      const loaded = await loadPlace();
      return loaded.kind === "loaded" ? loaded.data : undefined;
    },
  });

  // Shown, not modal, so the frame's Talk stays in reach.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) dialog.show();
  }, []);

  useEffect(() => {
    let url: string | undefined;
    let gone = false;
    void props.screen.then((blob) => {
      if (gone) return;
      if (blob === undefined) return setScreen({ kind: "failed" });
      url = URL.createObjectURL(blob);
      setScreen({ kind: "taken", blob, url });
    });
    return () => {
      gone = true;
      if (url !== undefined) URL.revokeObjectURL(url);
    };
  }, [props.screen]);

  // What's said goes in after anything typed (#264's way).
  const { offerTalk } = props;
  useEffect(
    () =>
      offerTalk({
        focus: () => box.current?.focus(),
        answering: false,
        dictate: () => {
          const typed = saidNow.current;
          const put = (words: string) =>
            setSaid(
              words === "" ? typed : typed.trim() === "" ? words : `${typed.trimEnd()} ${words}`,
            );
          return { hear: put, drop: () => put(""), done: () => {} };
        },
      }),
    [offerTalk],
  );

  // Escape closes it, unless it was talking's own Escape, dropping what was being said.
  useEffect(() => {
    const closing = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", closing);
    return () => window.removeEventListener("keydown", closing);
  }, [onClose]);

  const workspace = place?.workspace;
  const version = place?.version ?? null;
  const file = useAction(async () => {
    if (workspace === undefined) return "Still finding where it goes.";
    if (workspace === null) return NOWHERE;
    if (said.trim() === "") return "Say what's off first.";
    const filed = await fileReport(
      { ...filled, said: said.trim(), version },
      screen.kind === "taken" ? screen.blob : undefined,
    );
    if (filed.kind !== "loaded") return describeProblem(filed).body;
    onClose();
    return undefined;
  });

  const chips = [
    filled.page,
    sizeWords(filled.size),
    ...(version === null ? [] : [`Version ${version}`]),
    ...(filled.part === null ? [] : [filled.part]),
  ];

  return (
    <>
      {/* The page dims under it; the right rail, or the cover screen's talk row, stays in reach. */}
      <div
        data-friction=""
        aria-hidden
        onClick={onClose}
        className={classes(
          "fixed top-0 left-0 z-40 bg-card/60",
          cover
            ? "right-0 bottom-[var(--frame-talk,0px)]"
            : "right-[var(--frame-right,0px)] bottom-0",
        )}
      />
      <dialog
        ref={ref}
        data-friction=""
        aria-label="Something's off"
        className={classes(
          "fixed z-50 m-0 flex flex-col border border-input bg-surface p-0 text-foreground",
          cover
            ? "inset-x-2 top-auto bottom-[calc(var(--frame-talk,0px)+--spacing(2))] max-h-[calc(100dvh-var(--frame-talk,0px)---spacing(6))] w-auto rounded-sheet"
            : "top-auto right-[var(--frame-right,0px)] bottom-0 left-[var(--frame-left,0px)] mx-auto max-h-[calc(100dvh---spacing(6))] w-[min(--spacing(154),calc(100vw-var(--frame-left,0px)-var(--frame-right,0px)---spacing(8)))] rounded-t-sheet border-b-0",
        )}
      >
        <Scroller className="flex min-h-0 flex-col gap-4.5 px-6 pt-2.5 pb-6 max-md:px-4.5 max-md:pb-4.5">
          <span aria-hidden className="h-1 w-10 shrink-0 self-center rounded-full bg-input" />
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="display-title text-sheet-title">Something's off</h2>
            {workspace && (
              <span className="truncate text-meta font-semibold text-muted-foreground">
                Files it in {workspace.name}
              </span>
            )}
          </div>
          <div className="flex gap-4 max-md:gap-3">
            <Picture screen={screen} cover={cover} />
            <label className="flex min-w-0 grow flex-col gap-2 rounded-lg border border-input bg-secondary px-4 py-3.5 focus-within:border-primary">
              <CapsLabel tone="muted" inline>
                You said
              </CapsLabel>
              <textarea
                ref={box}
                value={said}
                onChange={(event) => setSaid(event.target.value)}
                rows={2}
                placeholder="Say what's off, or type it"
                className="min-h-12 resize-none bg-transparent text-answer font-medium text-foreground outline-none field-sizing-content placeholder:text-placeholder"
              />
              <span className="text-meta font-semibold text-primary-text">
                {fine ? "Hold Space to add more" : "Hold Talk to add more"}
              </span>
            </label>
          </div>
          <ul aria-label="What it filled in" className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <li
                key={chip}
                className="rounded-full border border-input px-3 py-1.5 text-meta font-semibold text-foreground/85"
              >
                {chip}
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-0.5 border-t border-border px-4 pt-3.5 max-md:px-0">
            <p className="text-sm font-bold text-foreground">
              Files an issue in Later, with the picture
            </p>
            <p className="text-label font-medium text-muted-foreground">
              A session writes it up and draws a fix on Drafts. Nothing is built until you agree it.
            </p>
          </div>
          {workspace === null && <p className="text-meta text-muted-foreground">{NOWHERE}</p>}
          <FormError message={file.error} />
          <div className="flex gap-2.5">
            <Button
              size="thumb"
              grow
              busy={file.busy}
              busyLabel="Filing…"
              disabled={workspace === null}
              onClick={() => void file.run()}
            >
              File it
            </Button>
            <Button size="thumb" variant="outline" waiting={file.busy} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </Scroller>
      </dialog>
    </>
  );
}

/** Why there's nowhere to file it. */
const NOWHERE =
  "No code workspace is on Courtyard's own repository, so there's nowhere to file it.";

/** The screen as it was at the tap: faint while it's taken, or a line saying it couldn't be. */
function Picture(props: { screen: Screen; cover: boolean }) {
  const { screen } = props;
  return (
    <div
      className={classes(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-row border border-input bg-card",
        props.cover ? "h-40 w-25" : "h-37 w-49",
      )}
    >
      {screen.kind === "taken" ? (
        <img
          src={screen.url}
          alt="The screen as it was"
          className="size-full object-cover object-top"
        />
      ) : screen.kind === "failed" ? (
        <p className="px-3 text-center text-label text-muted-foreground">
          Couldn't take the screen. It files with the page, size and version.
        </p>
      ) : (
        <span aria-hidden className="size-full bg-muted/40" />
      )}
    </div>
  );
}
