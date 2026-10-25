import { type BuildOpened, buildStarted } from "@courtyard/contract";
import { SegmentedChoice } from "@courtyard/ui/forms/segmented-choice.tsx";
import { useLayout, useWide } from "@courtyard/ui/frame/handheld.ts";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { useFresh } from "@courtyard/ui/layout/kept.tsx";
import { Scroller } from "@courtyard/ui/layout/scroller.tsx";
import { Sheet } from "@courtyard/ui/layout/sheet.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { useRouter } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { AtTheBench, PANEL, Plan } from "./at-the-bench.tsx";
import { BenchPanel } from "./bench-panel.tsx";
import { BuyList } from "./buy-list.tsx";
import { BuildChat, useBuildChat } from "./chat/build-chat.tsx";
import { type Asked, BenchAnswer, HoldToAsk } from "./chat/hold-to-ask.tsx";
import { CutPlan } from "./cut-plan.tsx";
import { FINDINGS_ID, Findings } from "./findings.tsx";
import { inView, useProgress } from "./progress.ts";
import { StepDots, StepFoot } from "./step-moves.tsx";
import { StepPanel } from "./step-panel.tsx";
import { useStockOptions } from "./stock-options.tsx";
import { ToolsList } from "./tools-list.tsx";
import { sizeLine, toCheck } from "./words.ts";

/** The side panel's tabs: in Plan on the Fold, and with the steps on a computer. */
const PLAN_TABS = ["Cut plan", "Buy list", "Tools"] as const;
const DESKTOP_TABS = [...PLAN_TABS, "Steps"] as const;
type Tab = (typeof DESKTOP_TABS)[number];

/** The Fold's two ways of working with a Build (#753): a step at a time, or the whole plan. */
type Mode = "bench" | "plan";
const MODES = [
  { value: "bench", label: "At the bench" },
  { value: "plan", label: "Plan" },
] as const satisfies readonly { value: Mode; label: string }[];

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
    <div role="tablist" aria-label="Show" className="flex shrink-0 flex-wrap gap-2">
      {props.tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={props.showing === tab}
          onClick={() => props.show(tab)}
          className={classes(
            "h-11 rounded-full border px-4 text-interface font-semibold",
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
 * A Build's page (#698; on the Fold, #753: Paper, 2 · Agreed, "Fabrication · At the bench · Fold
 * 933×645", "· At the bench · Cover 476×695" and "· Plan · Fold 933×645"). On the unfolded Fold,
 * one job at a time: At the bench, a step filling the screen (where a Build with steps opens), or
 * Plan, the Build in 3D with its cut plan, buy list and tools; the chat is behind Hold to ask, in
 * a sheet. Folded, At the bench alone, stacked. On a computer, the three panels: its chat, the
 * Build in 3D, and its cut plan, buy list, tools and steps. A part tapped anywhere is lit
 * everywhere.
 */
export function BuildPage(props: { build: BuildOpened }) {
  const { build } = props;
  const { derived, place } = build;
  const router = useRouter();
  const cover = useLayout() === "cover";
  const wide = useWide() && !cover;
  const [lit, setLit] = useState<string>();
  // Once building has started, a computer opens on the steps, where the owner left off (#699).
  const started = buildStarted(derived.steps, build.progress);
  const [side, setSide] = useState<Tab>(started ? "Steps" : "Cut plan");
  const [mode, setMode] = useState<Mode>("bench");
  const [draft, setDraft] = useState<{ text: string; files: File[]; key: number }>();
  const [chatOpen, setChatOpen] = useState(false);
  // What was asked with Hold to ask, so its answer shows.
  const [asked, setAsked] = useState<Asked>();
  const pick = (label: string) => setLit((now) => (now === label ? undefined : label));
  const reread = useCallback(() => void router.invalidate(), [router]);
  const openChat = useCallback(() => setChatOpen(true), []);
  const closeChat = useCallback(() => setChatOpen(false), []);
  const closeAnswer = useCallback(() => setAsked(undefined), []);
  // The Build may change from Courtyard too: it's read again the shared way.
  useFresh({ ask: () => router.invalidate() });
  const talk = useBuildChat({
    workspaceId: place.workspace.id,
    slug: build.slug,
    onChanged: reread,
  });
  const progress = useProgress(build, reread);
  const { step } = progress;
  const view = useMemo(
    () => (step === undefined ? undefined : inView(derived, step)),
    [derived, step],
  );
  const atBench = !wide && step !== undefined && view !== undefined && (cover || mode === "bench");

  // A stock's options, open in the side panel in place of its tab (#704).
  const stock = useStockOptions({
    where: { workspaceId: place.workspace.id, slug: build.slug },
    derived,
    reread: () => router.invalidate(),
  });
  // A tab tapped closes a stock's options, showing that tab.
  const showTab = (tab: Tab) => {
    stock.close();
    setSide(tab);
  };

  const checks = toCheck(derived.findings).length;
  const back = courtyardPlace(place);
  const name = `The ${derived.template.split("-").at(-1)}`;

  const showFindings = () => {
    setMode("plan");
    if (side === "Steps") setSide("Cut plan");
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
    if (!wide) setChatOpen(true);
  };

  const sideContent = (tab: Tab): ReactNode => {
    switch (tab) {
      case "Cut plan":
        return <CutPlan derived={derived} lit={lit} pick={pick} openOptions={stock.open} />;
      case "Buy list":
        return (
          <BuyList
            buyList={derived.buyList}
            withOptions={derived.options.map((options) => options.stock)}
            openOptions={stock.open}
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
  const sidePanel = (tab: Tab) =>
    tab === "Steps" && step !== undefined && !stock.showing ? (
      <>
        <Scroller className="flex min-h-0 flex-1 flex-col">
          <StepPanel derived={derived} step={step} progress={progress} sendPhoto={sendPhoto} />
        </Scroller>
        <StepFoot derived={derived} step={step} progress={progress} />
      </>
    ) : (
      <Scroller className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-col gap-4 pb-2">
          <Findings findings={derived.findings} />
          {stock.panel(tab) ?? sideContent(tab)}
        </div>
      </Scroller>
    );
  const chat = (
    <BuildChat
      talk={talk}
      showing={wide || chatOpen}
      placeholder={atBench || side === "Steps" ? "Ask about this step…" : "Change something…"}
      draft={draft}
      onDrafted={() => setDraft(undefined)}
    />
  );
  const ask = (withChat: boolean) => (
    <HoldToAsk
      talk={talk}
      about={atBench && step !== undefined ? `Step ${step.number}, ${step.title}` : undefined}
      openChat={openChat}
      asked={setAsked}
      withChat={withChat}
    />
  );
  const answer =
    asked === undefined ? null : (
      <BenchAnswer
        talk={talk}
        asked={asked}
        again={setAsked}
        close={closeAnswer}
        openChat={openChat}
      />
    );

  const toCheckButton = checks > 0 && (
    <button
      type="button"
      onClick={showFindings}
      className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-warning/50 bg-warning/10 px-4 text-interface font-bold text-warning"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-warning shadow-glow-needs" />
      {checks} to check
    </button>
  );

  if (wide) {
    return (
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 items-center gap-x-4 border-b border-border px-5 py-3">
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
              {sizeLine(derived.size)} · {derived.template.replaceAll("-", " ")}
            </p>
          </div>
          {toCheckButton}
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,2.1fr)_minmax(0,1.2fr)] gap-4 p-4">
          <div className={classes(PANEL, "gap-3")}>
            <CapsLabel tone="muted" heading={{ level: 2 }}>
              Chat
            </CapsLabel>
            {chat}
          </div>
          <div className={PANEL}>
            <BenchPanel
              name={name}
              derived={derived}
              lit={lit}
              pick={pick}
              atStep={
                side === "Steps" && step !== undefined && view !== undefined
                  ? { step, view }
                  : undefined
              }
              closeUp
              withKey
            />
          </div>
          <div className={classes(PANEL, "gap-4")}>
            <Tabs tabs={DESKTOP_TABS} showing={side} show={showTab} />
            {sidePanel(side)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2.5">
        <a
          href={back.href}
          aria-label={`Back to ${back.name}`}
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft aria-hidden className="size-5" />
        </a>
        <h1
          className={classes(
            "display-title shrink-0 truncate",
            cover ? "text-sheet-title" : "text-title",
          )}
        >
          {build.name}
        </h1>
        {atBench && step !== undefined ? (
          <StepDots derived={derived} step={step} />
        ) : (
          <p className="truncate font-mono text-meta text-muted-foreground">
            {sizeLine(derived.size)}
          </p>
        )}
        <span className="flex-1" />
        {!atBench && toCheckButton}
        {!cover && step !== undefined && (
          <SegmentedChoice
            label="Way of working"
            options={MODES}
            value={mode}
            onChange={setMode}
            look="switch"
          />
        )}
      </header>
      {atBench && step !== undefined && view !== undefined ? (
        <AtTheBench
          name={name}
          derived={derived}
          lit={lit}
          pick={pick}
          ask={ask(false)}
          answer={answer}
          step={step}
          view={view}
          progress={progress}
          sendPhoto={sendPhoto}
          cover={cover}
        />
      ) : (
        <Plan
          name={name}
          derived={derived}
          lit={lit}
          pick={pick}
          ask={ask(true)}
          answer={answer}
          cover={cover}
          side={
            <>
              <Tabs
                tabs={PLAN_TABS}
                showing={side === "Steps" ? "Cut plan" : side}
                show={showTab}
              />
              {sidePanel(side === "Steps" ? "Cut plan" : side)}
            </>
          }
        />
      )}
      <Sheet
        title="Chat"
        open={chatOpen}
        onClose={closeChat}
        from={cover ? "screen" : "right"}
        kind="conversation"
      >
        {chat}
      </Sheet>
    </div>
  );
}
