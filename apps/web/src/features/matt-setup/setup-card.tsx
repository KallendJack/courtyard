import {
  type MattSetup,
  type MattSetupAnswer,
  makesLabels,
  opensPullRequest,
  recommendedChoices,
  type SetupCard,
  type SetupChoices,
  type WorkspaceId,
} from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { Scroller } from "@courtyard/ui/layout/scroller.tsx";
import { type ReactNode, useState } from "react";
import { WebLink } from "@/components/buttons/web-link";
import { SegmentedChoice } from "@/components/forms/segmented-choice";
import { CardDialog } from "@/components/layout/card-dialog";
import { InfoBox } from "@/components/layout/notice";
import { describeProblem } from "../../components/layout/problems.tsx";
import { answerMattSetup } from "./api.ts";

/**
 * What setting up did (#181, #323), under Needs you on a code workspace's Home (#301): where the
 * pull request is, the issues moved from its old tracker, and its Paper file.
 */
export function MattSetupDone(props: { setup: Extract<MattSetup, { state: "opened" }> }) {
  const { pullRequest, issuesFiled, paper } = props.setup;
  return (
    <InfoBox label="Matt's setup">
      <span>
        {pullRequest === null ? (
          "The labels are made. Nothing else was missing."
        ) : (
          <>
            Matt's setup is in{" "}
            <WebLink href={pullRequest.url}>pull request #{pullRequest.number}</WebLink>, for you to
            review and merge.
          </>
        )}
        {issuesFiled > 0 &&
          ` ${issuesFiled} open ${issuesFiled === 1 ? "item is a GitHub issue" : "items are GitHub issues"} now.`}
        {paper.kind === "made" && ` Its Paper file, ${paper.name}, is connected.`}
        {paper.kind === "failed" && ` Its Paper file wasn't made: ${paper.reason}`}
      </span>
    </InfoBox>
  );
}

/**
 * The setup card (#323; Paper, "Tablet · Setup card with Paper file line"): what a code
 * workspace's repository has, and what moves it to the house standard, one line each, every line
 * filled in and the standard recommended (Keep where the repository says another agent writes its
 * tracker, saying why). A tap changes a line; one more sets it all up, in one pull request (AGENTS.md,
 * Tap or talk). Not now leaves it, and it isn't offered again. Opened from its row in Needs you.
 */
export function SetupSheet(props: {
  open: boolean;
  onClose: () => void;
  workspaceId: WorkspaceId;
  card: SetupCard;
  /** The card as the owner's answer leaves it. */
  onAnswered: (setup: MattSetup) => void;
}) {
  return (
    <CardDialog
      title="Set up Matt Pocock's skills"
      note="What this repo has, and what moves it to the house standard. One pull request."
      open={props.open}
      onClose={props.onClose}
    >
      <SheetBody {...props} />
    </CardDialog>
  );
}

function SheetBody(props: Parameters<typeof SetupSheet>[0]) {
  const { card } = props;
  const [choices, setChoices] = useState<SetupChoices>(() => recommendedChoices(card));
  const choose = (change: Partial<SetupChoices>) => setChoices((was) => ({ ...was, ...change }));

  const send = useAction(async (answer: MattSetupAnswer) => {
    const answered = await answerMattSetup(props.workspaceId, answer);
    if (answered.kind !== "loaded") return describeProblem(answered).body;
    props.onAnswered(answered.data);
    return undefined;
  });
  const setUp = () =>
    send.run({
      answer: "allow",
      ...(card.tracker === null ? {} : { tracker: choices.tracker }),
      ...(card.glossary === null ? {} : { glossary: choices.glossary }),
      ...(card.paper === null ? {} : { paper: choices.paper }),
    });

  return (
    // Its title and Set up stay put; only the lines between them scroll (#339).
    <>
      <Scroller data-dialog-body="" className="flex min-h-0 flex-col gap-2">
        {card.tracker !== null && (
          <Line title="Where work lives" found={<Path>{card.tracker.path}</Path>}>
            <SegmentedChoice
              label="Where work lives"
              look="apart"
              value={choices.tracker}
              onChange={(tracker) => choose({ tracker })}
              options={
                card.tracker.recommended === "keep"
                  ? [
                      { value: "keep", label: "Keep" },
                      { value: "move", label: "Move to GitHub issues" },
                    ]
                  : [
                      { value: "move", label: "Move to GitHub issues" },
                      { value: "keep", label: "Keep" },
                    ]
              }
            />
            {card.tracker.recommended === "keep" && (
              <p className="text-meta font-medium text-primary-text">
                Recommended: {card.tracker.why}
              </p>
            )}
          </Line>
        )}
        {card.glossary !== null && (
          <Line title="Glossary" found={<Path>{card.glossary.path}</Path>}>
            <SegmentedChoice
              label="Glossary"
              look="apart"
              value={choices.glossary}
              onChange={(glossary) => choose({ glossary })}
              options={[
                { value: "rename", label: "Rename to GLOSSARY.md" },
                { value: "keep", label: "Keep" },
              ]}
            />
          </Line>
        )}
        {card.files.length > 0 && (
          <Line
            title="Matt's files"
            found={<Added>Added to docs/agents/</Added>}
            detail={card.files.map((path) => path.replace("docs/agents/", "")).join(" · ")}
          />
        )}
        {card.section !== null && (
          <Line title="Agent skills section" found={<Added>Added to {card.section.path}</Added>} />
        )}
        {makesLabels(card, choices.tracker) && (
          <Line
            title="Triage labels"
            found={<Added>Made on GitHub</Added>}
            detail={card.labels.join(" · ")}
          />
        )}
        {card.paper !== null && (
          <Line
            title="Paper file"
            found={<span className="text-meta text-muted-foreground">None yet · optional</span>}
          >
            <SegmentedChoice
              label="Paper file"
              look="apart"
              value={choices.paper}
              onChange={(paper) => choose({ paper })}
              options={[
                { value: "create", label: `Create · ${card.paper.name}, 4 pages` },
                { value: "skip", label: "Skip" },
              ]}
            />
          </Line>
        )}
      </Scroller>

      <div className="flex shrink-0 flex-col gap-2 pt-1">
        <Button
          size="lg"
          fullWidth
          busy={send.running?.[0].answer === "allow"}
          busyLabel="Setting up…"
          waiting={send.running?.[0].answer === "not-now"}
          onClick={() => void setUp()}
        >
          {opensPullRequest(card) ? "Set up · opens a pull request" : "Set up"}
        </Button>
        <Button
          variant="quiet"
          fullWidth
          waiting={send.busy}
          onClick={() => void send.run({ answer: "not-now" })}
        >
          Not now
        </Button>
        <FormError message={send.error} />
      </div>
    </>
  );
}

/** One line of the card: what it's about, what Courtyard found, and its choice if it has one. */
function Line(props: { title: string; found: ReactNode; detail?: string; children?: ReactNode }) {
  return (
    <section
      aria-label={props.title}
      className="flex flex-col gap-2.5 rounded-bubble bg-secondary px-3.5 py-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-interface font-bold">{props.title}</h3>
        {props.found}
      </div>
      {props.detail !== undefined && (
        <p className="-mt-1.5 text-meta text-muted-foreground">{props.detail}</p>
      )}
      {props.children}
    </section>
  );
}

/** A file or folder Courtyard found, as its path. */
function Path(props: { children: string }) {
  return (
    <span className="truncate font-mono text-caption text-muted-foreground">{props.children}</span>
  );
}

/** What setting up adds, in moss: it's done for the owner. */
function Added(props: { children: ReactNode }) {
  return <span className="text-meta font-medium text-success">{props.children}</span>;
}
