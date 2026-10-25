import { type BuildOpened, buildStarted, type ChangeId } from "@courtyard/contract";
import { useLayout } from "@courtyard/ui/frame/handheld.ts";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { useFresh } from "@courtyard/ui/layout/kept.tsx";
import { Scroller } from "@courtyard/ui/layout/scroller.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { useRouter } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { type Answer, pickStock, undoBuildChange } from "../../api/fabrication.ts";
import { BenchPanel } from "./bench-panel.tsx";
import { BuildChat } from "./build-chat.tsx";
import { BuyList } from "./buy-list.tsx";
import { CloseUp } from "./close-up.tsx";
import { CutPlan } from "./cut-plan.tsx";
import { FINDINGS_ID, Findings } from "./findings.tsx";
import { useProgress } from "./progress.ts";
import { StepFoot, StepPanel } from "./step-panel.tsx";
import { type JustPicked, type Pickable, StockOptionsPanel } from "./stock-options.tsx";
import { ToolsList } from "./tools-list.tsx";
import { sizeLine, toCheck } from "./words.ts";

/** The side panel's tabs, as the board has them; on the cover screen, the 3D view and chat too. */
const SIDE_TABS = ["Cut plan", "Buy list", "Tools", "Steps"] as const;
const COVER_TABS = ["Bench", "Chat", ...SIDE_TABS] as const;
type Tab = (typeof COVER_TABS)[number];

/** A panel on the PC and the unfolded Fold: one of the board's three. */
const PANEL = "flex min-h-0 flex-col rounded-card border border-border bg-surface p-4";

/** Why a change didn't happen, as its panel says it. */
const problemOf = (answer: Exclude<Answer<unknown>, { kind: "loaded" }>) =>
  answer.kind === "failed" ? answer.message : "Can't reach Courtyard's worker. Try again.";

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
 * its cut plan, buy list, tools and steps. On the cover screen the panels are tabs. A part tapped
 * anywhere is lit everywhere.
 */
export function BuildPage(props: { build: BuildOpened }) {
  const { build } = props;
  const { derived, place } = build;
  const router = useRouter();
  const cover = useLayout() === "cover";
  const [lit, setLit] = useState<string>();
  // Once building has started, the Build opens on the steps, where the owner left off (#699).
  const started = buildStarted(derived.steps, build.progress);
  const [side, setSide] = useState<(typeof SIDE_TABS)[number]>(started ? "Steps" : "Cut plan");
  const [coverTab, setCoverTab] = useState<Tab>(started ? "Steps" : "Bench");
  const [draft, setDraft] = useState<{ text: string; files: File[]; key: number }>();
  const pick = (label: string) => setLit((now) => (now === label ? undefined : label));
  const reread = useCallback(() => void router.invalidate(), [router]);
  // The Build may change from Courtyard too: it's read again the shared way.
  useFresh({ ask: () => router.invalidate() });
  const progress = useProgress(build, reread);
  const { step } = progress;
  // A part's card covers the picture, so a new step closes it (#754).
  const [cardStep, setCardStep] = useState(step?.id);
  if (cardStep !== step?.id) {
    setCardStep(step?.id);
    setLit(undefined);
  }
  const stepsShowing = cover ? coverTab === "Steps" : side === "Steps";
  const atStep = stepsShowing && step !== undefined ? { step, progress } : undefined;

  // A stock's options, open in the side panel in place of its tab, and the pick just made (#704).
  const [choosing, setChoosing] = useState<string>();
  const [justPicked, setJustPicked] = useState<
    JustPicked & { readonly change: ChangeId; readonly before: string }
  >();
  const where = { workspaceId: place.workspace.id, slug: build.slug };
  const picking = useAction(async (stock: string, choice: Pickable) => {
    const done = await pickStock(where, { stock, option: choice.option });
    if (done.kind !== "loaded") return problemOf(done);
    const { change } = done.data;
    setJustPicked(
      change === null
        ? undefined
        : { stock: choice.stock, title: choice.title, change, before: stock },
    );
    setChoosing(choice.stock);
    await router.invalidate();
    return undefined;
  });
  const undoing = useAction(async () => {
    if (justPicked === undefined) return undefined;
    const done = await undoBuildChange(where, justPicked.change);
    if (done.kind !== "loaded") return problemOf(done);
    setChoosing(justPicked.before);
    setJustPicked(undefined);
    await router.invalidate();
    return undefined;
  });
  const openOptions = (stock: string) => {
    picking.setError(undefined);
    undoing.setError(undefined);
    setChoosing(stock);
  };
  const choosingOptions = derived.options.find((options) => options.stock === choosing);

  const checks = toCheck(derived.findings).length;
  const back = courtyardPlace(place);

  const showFindings = () => {
    if (cover && (coverTab === "Bench" || coverTab === "Chat" || coverTab === "Steps")) {
      setCoverTab("Cut plan");
    }
    if (!cover && side === "Steps") setSide("Cut plan");
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

  const sideContent = (tab: (typeof SIDE_TABS)[number]): ReactNode => {
    switch (tab) {
      case "Cut plan":
        return <CutPlan derived={derived} lit={lit} pick={pick} openOptions={openOptions} />;
      case "Buy list":
        return (
          <BuyList
            buyList={derived.buyList}
            withOptions={derived.options.map((options) => options.stock)}
            openOptions={openOptions}
          />
        );
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
  const sidePanel = (tab: (typeof SIDE_TABS)[number]) =>
    tab === "Steps" && choosingOptions === undefined ? (
      steps(false)
    ) : (
      <Scroller className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-col gap-4 pb-2">
          <Findings findings={derived.findings} />
          {choosingOptions === undefined ? (
            sideContent(tab)
          ) : (
            <StockOptionsPanel
              options={choosingOptions}
              backTo={tab}
              back={() => setChoosing(undefined)}
              pick={(choice) => void picking.run(choosingOptions.stock, choice)}
              picking={picking.running?.[1].option}
              justPicked={justPicked?.stock === choosingOptions.stock ? justPicked : undefined}
              undo={() => void undoing.run()}
              undoing={undoing.busy}
              error={picking.error ?? undoing.error}
            />
          )}
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
  const bench = (
    <BenchPanel
      name={`The ${derived.template.split("-").at(-1)}`}
      derived={derived}
      lit={lit}
      pick={pick}
      atStep={atStep}
    />
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
          {sizeLine(derived.size)}
          {cover ? "" : ` · ${derived.template.replaceAll("-", " ")}`}
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
          <Tabs
            tabs={COVER_TABS}
            showing={coverTab}
            show={(tab) => {
              setChoosing(undefined);
              setCoverTab(tab);
            }}
          />
          <div className={classes(PANEL, "flex-1")}>
            {coverTab === "Bench" ? (
              bench
            ) : coverTab === "Chat" ? (
              chat
            ) : coverTab === "Steps" ? (
              // As the cover board has it: the step in 3D above, its words below.
              <>
                <div className="flex h-56 shrink-0 flex-col pb-3">
                  <BenchPanel
                    name={`The ${derived.template.split("-").at(-1)}`}
                    derived={derived}
                    lit={lit}
                    pick={pick}
                    atStep={atStep}
                    closeUp={false}
                  />
                </div>
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
        <div className={PANEL}>{bench}</div>
        <div className={classes(PANEL, "gap-4")}>
          <Tabs
            tabs={SIDE_TABS}
            showing={side}
            show={(tab) => {
              setChoosing(undefined);
              setSide(tab as typeof side);
            }}
          />
          {sidePanel(side)}
        </div>
      </div>
    </div>
  );
}
