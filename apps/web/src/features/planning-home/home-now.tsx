import type {
  HomeView,
  HomeViewId,
  PlanningHome,
  ThingSummary,
  WorkspaceId,
} from "@courtyard/contract";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { SuggestedReplies } from "@/components/chat/suggested-replies";
import { SegmentedChoice } from "@/components/forms/segmented-choice";
import { classes } from "@/lib/classes";
import { describeProblem } from "../../components/layout/problems.tsx";
import { KEPT_HOME, pickView } from "./api.ts";
import { PictureView } from "./picture-view.tsx";

type Picture = Extract<HomeView, { kind: "picture" }>;

/**
 * The views Home draws so far: a Thing's photo with its parts pinned. The wanted list comes whole
 * with its picks and shop links (#245), so until then it's left out, never half drawn.
 */
const drawn = (views: readonly HomeView[]) =>
  views.filter((view): view is Picture => view.kind === "picture");

/**
 * A planning workspace's Home now (#481; Paper, "Tablet · Home: the bike, parts pinned"): the
 * owner's last question, opening its session; the view showing in one big panel, with a chip for
 * each when there are several; and the next steps its answer suggested, each replying with a
 * tap. With nothing to show yet, the last question and its next steps alone: the Reply box under
 * them carries the conversation on.
 */
export function HomeNow(props: {
  workspaceId: WorkspaceId;
  home: PlanningHome;
  things: readonly ThingSummary[];
  /** Replies to the last question with a next step: whether it was sent. */
  reply: (step: string) => Promise<boolean>;
  /** Once something on it changed: Home loads again. */
  changed: () => Promise<void>;
}) {
  const { workspaceId, home } = props;
  const { question } = home;
  const views = drawn(home.views);
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
    <div className={classes("flex flex-col gap-3", showing !== undefined && "md:min-h-0 md:grow")}>
      {question !== null && (
        <div className="flex flex-col items-end gap-1">
          <Link
            to="/workspaces/$workspaceId/sessions/$sessionId"
            params={{ workspaceId, sessionId: question.session }}
            aria-label={`Your last question: ${question.text}`}
            className="max-w-115 rounded-t-bubble rounded-bl-bubble rounded-br-sm bg-accent px-4.5 py-3 text-interface font-medium text-foreground/95 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="line-clamp-3 wrap-anywhere whitespace-pre-line">{question.text}</span>
          </Link>
          {question.answering && <p className="text-meta text-muted-foreground">Being answered…</p>}
        </div>
      )}
      {showing !== undefined && (
        <div className="flex flex-col gap-2.5 rounded-card border bg-surface px-3.5 py-3 md:min-h-0 md:grow">
          {views.length > 1 && (
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
          <PictureView
            key={showing.id}
            workspaceId={workspaceId}
            view={showing}
            things={props.things}
            changed={props.changed}
          />
        </div>
      )}
      {question !== null && question.nextSteps.length > 0 && (
        <SuggestedReplies
          key={question.session + question.at}
          replies={question.nextSteps}
          onPick={props.reply}
          row={{ label: "Next steps" }}
        />
      )}
    </div>
  );
}
