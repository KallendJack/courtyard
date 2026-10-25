import { type BuildOpened, buildStarted } from "@courtyard/contract";
import { useLayout } from "@courtyard/ui/frame/handheld.ts";
import { useFresh } from "@courtyard/ui/layout/kept.tsx";
import { Scroller } from "@courtyard/ui/layout/scroller.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { useRouter } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { BenchPanel } from "./bench-panel.tsx";
import { BuildChat } from "./build-chat.tsx";
import { BuyList } from "./buy-list.tsx";
import { CloseUp } from "./close-up.tsx";
import { CutPlan } from "./cut-plan.tsx";
import { FINDINGS_ID, Findings } from "./findings.tsx";
import { PrintPanel, PrintTab, useMaking } from "./print-panel.tsx";
import { inView, useProgress } from "./progress.ts";
import { StepFoot, StepPanel } from "./step-panel.tsx";
import { ToolsList } from "./tools-list.tsx";
import { checkCards, printSizeLine, sizeLine } from "./words.ts";

/**
 * The side panel's tabs, as the boards have them, for a bench and for a printed part (#702); on
 * the cover screen, the 3D view and chat too.
 */
const BENCH_TABS = ["Cut plan", "Buy list", "Tools", "Steps"] as const;
const PRINT_TABS = ["Print", "Buy list", "Steps"] as const;
type SideTab = (typeof BENCH_TABS)[number] | (typeof PRINT_TABS)[number];
type Tab = SideTab | "Bench" | "Part" | "Chat";

/** A panel on the PC and the unfolded Fold: one of the board's three. */
const PANEL = "flex min-h-0 flex-col rounded-card border border-border bg-surface p-4";

/** Where the Build is in Courtyard: its project on its workspace's page, or the workspace. */
const courtyardPlace = (place: BuildOpened["place"]) => {
  const workspace = `/workspaces/${encodeURIComponent(place.workspace.id)}`;
  return place.project === null
    ? { href: workspace, name: place.workspace.name }
    : {
        href: `${workspace}#project/${place.project.slug}`,
        name: `${place.workspace.name} · ${place.project.name}`,
      };
};

function Tabs(props: { tabs: readonly Tab[]; showing: Tab; show: (tab: Tab) => void }) {
  return (
    <div role="tablist" aria-label="Show" className="flex shrink-0 flex-wrap gap-1.5">
      {props.tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={props.showing === tab}
          onClick={() => props.show(tab)}
          className={classes(
            "h-9 rounded-full border px-3.5 text-interface font-semibold",
            props.showing === tab
              ? "border-primary bg-primary/15 text-foreground"
              : "border-transparent bg-muted text-muted-foreground hover:text-foreground",
          )}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

/**
 * A Build's page (#698; Paper, 2 · Agreed, "Fabrication · A Build · Tablet (#698)" and
 * "· Desktop 1440×900 (#698)"): a top bar with the way back to its project in Courtyard, its name
 * and size, and what the making rules found; then three panels, its chat, the Build in 3D, and
 * its cut plan, buy list, tools and steps. A printed part (#702; "· Text to print · Tablet
 * (#702)") shows itself on the printer's plate, and its Print tab before its buy list and steps.
 * On the cover screen the panels are tabs. A part tapped anywhere is lit everywhere.
 */
export function BuildPage(props: { build: BuildOpened }) {
  const { build } = props;
  const { derived, place } = build;
  const { print } = derived;
  const router = useRouter();
  const cover = useLayout() === "cover";
  const sideTabs: readonly SideTab[] = print === null ? BENCH_TABS : PRINT_TABS;
  const coverTabs: readonly Tab[] = [print === null ? "Bench" : "Part", "Chat", ...sideTabs];
  const firstSide = sideTabs[0] ?? "Buy list";
  const [lit, setLit] = useState<string>();
  // Once building has started, the Build opens on the steps, where the owner left off (#699).
  const started = buildStarted(derived.steps, build.progress);
  const [side, setSide] = useState<SideTab>(started ? "Steps" : firstSide);
  const [coverTab, setCoverTab] = useState<Tab>(started ? "Steps" : (coverTabs[0] ?? "Chat"));
  const [draft, setDraft] = useState<{ text: string; files: File[]; key: number }>();
  const pick = (label: string) => setLit((now) => (now === label ? undefined : label));
  const reread = useCallback(() => void router.invalidate(), [router]);
  // The Build may change from Courtyard too: it's read again the shared way.
  useFresh({ ask: () => router.invalidate() });
  const making = useMaking({ workspaceId: place.workspace.id, slug: build.slug, derived });
  const progress = useProgress(build, reread);
  const { step } = progress;
  const view = useMemo(
    () => (step === undefined ? undefined : inView(derived, step)),
    [derived, step],
  );
  const stepsShowing = cover ? coverTab === "Steps" : side === "Steps";
  const atStep =
    stepsShowing && step !== undefined && view !== undefined ? { step, view, progress } : undefined;

  const checks = checkCards(derived.findings, print).length;
  const back = courtyardPlace(place);

  const showFindings = () => {
    if (cover && (coverTab === "Steps" || !(sideTabs as readonly Tab[]).includes(coverTab))) {
      setCoverTab(firstSide);
    }
    if (!cover && side === "Steps") setSide(firstSide);
    requestAnimationFrame(() => document.getElementById(FINDINGS_ID)?.focus());
  };

  // "Send a photo to check" (#699): the photo and what it's for go in the chat's Reply box, for
  // the owner to see and send with one tap.
  const sendPhoto = (photo: File) => {
    if (step === undefined) return;
    setDraft({
      text: `Step ${step.number}, ${step.title}: ${step.check.photo} ${step.check.says} Does it look right?`,
      files: [photo],
      key: Date.now(),
    });
    if (cover) setCoverTab("Chat");
  };

  const sideContent = (tab: SideTab): ReactNode => {
    switch (tab) {
      case "Print":
        return print === null ? null : (
          <PrintTab
            print={print}
            making={making}
            workspaceId={place.workspace.id}
            slug={build.slug}
          />
        );
      case "Cut plan":
        return <CutPlan derived={derived} lit={lit} pick={pick} />;
      case "Buy list":
        return <BuyList buyList={derived.buyList} />;
      case "Tools":
        return (
          <ToolsList
            derived={derived}
            build={`/workspaces/${encodeURIComponent(place.workspace.id)}/builds/${build.slug}`}
          />
        );
      case "Steps":
        return null;
    }
  };
  /** The steps, one at a time, with Back and Done pinned at the foot. */
  const steps = (withCloseUp: boolean) =>
    step === undefined ? null : (
      <>
        <Scroller className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-4">
            <StepPanel derived={derived} step={step} progress={progress} sendPhoto={sendPhoto} />
            {withCloseUp && step.closeUp !== null && (
              <CloseUp closeUp={step.closeUp} parts={derived.parts} narrow />
            )}
          </div>
        </Scroller>
        <StepFoot derived={derived} step={step} progress={progress} />
      </>
    );
  const sidePanel = (tab: SideTab) =>
    tab === "Steps" ? (
      steps(false)
    ) : (
      <Scroller className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-col gap-4 pb-2">
          <Findings findings={derived.findings} print={print} />
          {sideContent(tab)}
        </div>
      </Scroller>
    );
  const chat = (
    <BuildChat
      workspaceId={place.workspace.id}
      slug={build.slug}
      onChanged={reread}
      placeholder={stepsShowing ? "Ask about this step…" : "Change something…"}
      draft={draft}
      onDrafted={() => setDraft(undefined)}
    />
  );
  /** The Build in 3D: the bench built up to the step reached, or the printed part on its plate. */
  const inThreeD = (closeUp: boolean) =>
    print === null ? (
      <BenchPanel
        name={`The ${derived.template.split("-").at(-1)}`}
        derived={derived}
        lit={lit}
        pick={pick}
        atStep={atStep}
        closeUp={closeUp}
      />
    ) : (
      <PrintPanel print={print} making={making} />
    );

  const header = (
    <header
      className={classes(
        "flex shrink-0 gap-x-4 gap-y-1.5 border-b border-border",
        cover ? "flex-col px-4 pt-4 pb-3" : "items-center px-5 py-3",
      )}
    >
      <a
        href={back.href}
        className="flex min-w-0 shrink-0 items-center gap-1 text-meta text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft aria-hidden className="size-4" />
        <span className="sr-only">Back to </span>
        <span className="truncate">{back.name}</span>
      </a>
      <div className="flex min-w-0 flex-1 items-baseline gap-3">
        <h1 className="display-title truncate text-title">{build.name}</h1>
        <p className="truncate font-mono text-meta text-muted-foreground">
          {print === null ? sizeLine(derived.size) : printSizeLine(derived.size)}
          {cover
            ? ""
            : ` · ${print === null ? derived.template.replaceAll("-", " ") : "printed part"}`}
        </p>
      </div>
      {checks > 0 && (
        <button
          type="button"
          onClick={showFindings}
          className={classes(
            "flex h-9 shrink-0 items-center gap-2 rounded-full border border-warning/50 bg-warning/10 px-3.5 text-meta font-bold text-warning",
            cover && "self-start",
          )}
        >
          <span aria-hidden className="size-1.5 rounded-full bg-warning shadow-glow-needs" />
          {checks} to check
        </button>
      )}
    </header>
  );

  if (cover) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-3 pb-4">
          <Tabs tabs={coverTabs} showing={coverTab} show={setCoverTab} />
          <div className={classes(PANEL, "flex-1")}>
            {coverTab === "Bench" || coverTab === "Part" ? (
              inThreeD(true)
            ) : coverTab === "Chat" ? (
              chat
            ) : coverTab === "Steps" ? (
              // As the cover board has it: the step in 3D above, its words below.
              <>
                <div className="flex h-56 shrink-0 flex-col pb-3">{inThreeD(false)}</div>
                {steps(true)}
              </>
            ) : (
              sidePanel(coverTab)
            )}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.3fr)] gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,2.1fr)_minmax(0,1.2fr)] xl:gap-4 xl:p-4">
        <div className={PANEL}>{chat}</div>
        <div className={PANEL}>{inThreeD(true)}</div>
        <div className={classes(PANEL, "gap-4")}>
          <Tabs tabs={sideTabs} showing={side} show={(tab) => setSide(tab as SideTab)} />
          {sidePanel(side)}
        </div>
      </div>
    </div>
  );
}
