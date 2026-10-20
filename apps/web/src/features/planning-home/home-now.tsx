import type { HomeViewId, PlanningHome, ThingSummary, WorkspaceId } from "@courtyard/contract";
import { useState } from "react";
import { SegmentedChoice } from "@/components/forms/segmented-choice";
import { describeProblem } from "../../components/layout/problems.tsx";
import { FencedBlock, fencedKind, OnHome } from "../../components/rich-blocks/fenced.tsx";
import { KEPT_HOME, pickView } from "./api.ts";
import { BreakdownView } from "./breakdown-view.tsx";

/** A floor plan is drawn as in an answer, by its rich block, loaded only when Home has one. */
const PLAN = fencedKind("plan");

/**
 * A planning workspace's Home now (#565; Paper, "Tablet · Planning Home: the bike, part by part
 * (#565)"): a view of the workspace's main subject in one big panel, and nothing else: no chat. A
 * Thing broken down part by part, or a room's floor plan (#257). A chip for each view when there
 * are several, the owner's pick sticking. With nothing to show, the panel keeps its size with one
 * quiet line (#398).
 */
export function HomeNow(props: {
  workspaceId: WorkspaceId;
  home: PlanningHome;
  things: readonly ThingSummary[];
  /** Opens the box with these words, to start a session: a part's Ask about it. */
  ask: (text: string) => void;
  /** Once something on it changed: Home loads again. */
  changed: () => Promise<void>;
}) {
  const { workspaceId, home } = props;
  const { views } = home;
  /** The chip tapped, shown at once while the worker keeps the pick. */
  const [picking, setPicking] = useState<HomeViewId>();
  const [problem, setProblem] = useState<string>();
  const showing =
    views.find((view) => view.id === (picking ?? home.showing)) ?? views[0] ?? undefined;

  const pick = async (view: HomeViewId) => {
    setPicking(view);
    const picked = await pickView(workspaceId, view);
    if (picked.kind === "loaded") {
      KEPT_HOME.set(workspaceId, picked.data);
      setProblem(undefined);
    } else setProblem(describeProblem(picked).body);
    setPicking(undefined);
  };

  return (
    <div className="flex min-h-80 flex-col gap-2.5 rounded-card border bg-surface px-3.5 py-3 md:min-h-0 md:grow">
      {views.length > 1 && showing !== undefined && (
        <SegmentedChoice
          label="Views"
          look="chips"
          options={views.map((view) => ({ value: view.id, label: view.title }))}
          value={showing.id}
          onChange={(view) => void pick(view)}
        />
      )}
      {problem !== undefined && (
        <p role="alert" className="text-meta text-destructive-text">
          {problem}
        </p>
      )}
      {showing === undefined ? (
        <div className="flex grow items-center justify-center">
          <p className="max-w-80 text-center text-body text-muted-foreground">
            A Thing with a photo and parts shows here, part by part.
          </p>
        </div>
      ) : showing.kind === "plan" ? (
        PLAN !== undefined && (
          <OnHome value={true}>
            <FencedBlock
              key={showing.id}
              kind={PLAN}
              language="plan"
              source={JSON.stringify(showing.plan)}
            />
          </OnHome>
        )
      ) : (
        <BreakdownView
          key={showing.id}
          workspaceId={workspaceId}
          view={showing}
          things={props.things}
          ask={props.ask}
          changed={props.changed}
        />
      )}
    </div>
  );
}
