import type {
  BuildPrint,
  BuildSlug,
  DerivedBuild,
  MadePart,
  SizeSource,
  WorkspaceId,
} from "@courtyard/contract";
import { buttonLook } from "@courtyard/ui/buttons/button.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { createKept, PlaceholderRows, useKept } from "@courtyard/ui/layout/kept.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { lazy, Suspense } from "react";
import { madePart, printFile } from "@/api/fabrication";
import { clearanceLine, mm, printSizeLine } from "../words.ts";

// A printed part's own (#702; Paper, 2 · Agreed, "Fabrication · Text to print · Tablet (#702)"):
// the part in 3D on the printer's plate, and the Print tab with its sizes, its file, and the way
// to the printer.

/** The 3D view, with `three`, in a file of its own: only a printed part's page loads it. */
const PrintView = lazy(() => import("./print-view.tsx"));

/** A part as the worker made it, or why it couldn't. */
export type Making =
  | { readonly kind: "made"; readonly made: MadePart }
  | { readonly kind: "failed"; readonly message: string };

const makings = createKept<Making>();

/**
 * A printed part's Build made, kept for the tab (`undefined` until the first answer), and asked
 * for again when its Build changes. The worker keeps what it made, so asking again is quick.
 */
export const useMaking = (options: {
  workspaceId: WorkspaceId;
  slug: BuildSlug;
  derived: DerivedBuild;
}) => {
  const { workspaceId, slug, derived } = options;
  return useKept(makings, {
    key: `${workspaceId}/${slug}`,
    load: async (): Promise<Making | undefined> => {
      const answer = await madePart(workspaceId, slug);
      if (answer.kind === "loaded") return { kind: "made", made: answer.data };
      if (answer.kind === "failed") return { kind: "failed", message: answer.message };
      return undefined;
    },
    again: JSON.stringify([derived.size, derived.print]),
    asking: derived.print !== null,
  });
};

/**
 * The part on the plate (the board's middle panel): drag to turn it. Under it, whether it fits
 * and the clearance its holes allow.
 */
export function PrintPanel(props: { print: BuildPrint; making: Making | undefined }) {
  const { print, making } = props;
  return (
    <section aria-label="In 3D" className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <CapsLabel tone="muted" heading={{ level: 2 }}>
          On the plate · {mm(print.plate.width)} mm
        </CapsLabel>
        <span className="text-meta text-muted-foreground">Drag to turn</span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {making?.kind === "made" ? (
          <Suspense fallback={null}>
            <PrintView made={making.made} plate={print.plate} />
          </Suspense>
        ) : making?.kind === "failed" ? (
          <p className="flex h-full items-center justify-center px-6 text-center text-meta text-muted-foreground">
            {making.message}
          </p>
        ) : (
          <PlaceholderRows count={1} size="panel" />
        )}
      </div>
      <p className="text-meta text-muted-foreground">
        {print.fits ? "Fits the plate" : "Too big for the plate"} · {clearanceLine(print)}
      </p>
    </section>
  );
}

const SOURCE_TONE: Readonly<Record<SizeSource["kind"], string>> = {
  assumed: "text-warning",
  measured: "text-success",
  specified: "text-success",
};

/**
 * The Print tab (the board's right panel): each size with its source, the part's file, Open in
 * Bambu Studio (its 3MF, which Bambu Studio opens), and Send to printer, which waits for one.
 */
export function PrintTab(props: {
  print: BuildPrint;
  making: Making | undefined;
  workspaceId: WorkspaceId;
  slug: BuildSlug;
}) {
  const { print, making, workspaceId, slug } = props;
  const made = making?.kind === "made" ? making.made : undefined;
  return (
    <section aria-label="Print" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <CapsLabel tone="muted" heading={{ level: 3 }}>
          Sizes
        </CapsLabel>
        <dl className="flex flex-col gap-1.5 text-interface">
          {print.sizes.map(({ name, says, source }) => (
            <div key={name} className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-foreground">{name}</dt>
              <dd
                className={classes(
                  "min-w-0 text-right",
                  source === null ? "font-mono text-foreground" : SOURCE_TONE[source.kind],
                )}
              >
                {source === null ? says : `${says} · ${source.kind}`}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex flex-col gap-2">
        <CapsLabel tone="muted" heading={{ level: 3 }}>
          File
        </CapsLabel>
        <p className="flex items-baseline justify-between gap-3 rounded-row bg-muted px-3.5 py-3">
          <span className="truncate font-mono text-interface font-bold text-foreground">
            {slug}.3mf
          </span>
          <span
            className={classes(
              "shrink-0 font-mono text-meta",
              made ? "text-success" : making ? "text-destructive-text" : "text-muted-foreground",
            )}
          >
            {made ? "ready" : making ? "can't be made" : "making…"}
          </span>
        </p>
        {made && (
          <p className="text-meta text-muted-foreground">
            {printSizeLine(made.size)} · about {made.grams} g of filament at most
          </p>
        )}
        {made ? (
          <a
            href={printFile(workspaceId, slug, made.files.threeMf)}
            download={made.files.threeMf}
            className={buttonLook({ variant: "primary", size: "thumb" })}
          >
            Open in Bambu Studio
          </a>
        ) : (
          <button
            type="button"
            disabled
            className={buttonLook({ variant: "primary", size: "thumb" })}
          >
            Open in Bambu Studio
          </button>
        )}
        <button
          type="button"
          disabled
          className={buttonLook({ variant: "outline", size: "thumb" })}
        >
          Send to printer · once you have one
        </button>
        {made && (
          <a
            href={printFile(workspaceId, slug, made.files.stl)}
            download={made.files.stl}
            className="self-center text-meta text-muted-foreground underline hover:text-foreground"
          >
            Or the STL, for another slicer
          </a>
        )}
      </div>
    </section>
  );
}
