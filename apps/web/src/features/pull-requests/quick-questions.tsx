import type { QuickAnswer, QuickLine } from "@courtyard/contract";
import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { Button, IconButton } from "@/components/button";
import { Scroller } from "@/components/scroller";
import { classes } from "@/lib/classes";
import { Answer } from "../sessions/answer.tsx";

/** A file's name without its folders: "slot-row.tsx". */
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * Quick questions about a pull request (#327; Paper, "PR page: quick questions"): the small
 * read-only conversation on its page, each question and its answer, with the lines an answer
 * points at, a tap showing one in the diff. Its header says which model answers and that it only
 * reads the pull request. Beside the diff from a tablet up (`panel`), in the file list's place;
 * on a phone a sheet over the diff (`sheet`), with its own ask line at its foot.
 */
export function QuickQuestionsPanel(props: {
  look: "panel" | "sheet";
  /** The model that answers, in a word or two: "Sonnet 5.5". */
  model: string | undefined;
  asked: readonly QuickAnswer[];
  /** A question asked whose answer hasn't come yet. */
  pending: string | undefined;
  onClose: () => void;
  onPoint: (line: QuickLine) => void;
  /** Kept at the sheet's foot: its ask line. */
  foot?: ReactNode;
}) {
  /** What scrolls: the questions and their answers. */
  const conversation = useRef<HTMLElement>(null);
  const count = props.asked.length;
  const { pending } = props;

  // The newest question and its answer come into view as they arrive.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each time one is asked or answered
  useEffect(() => {
    const scroller = conversation.current;
    if (scroller !== null) scroller.scrollTop = scroller.scrollHeight;
  }, [count, pending]);

  const sheet = props.look === "sheet";
  return (
    <section
      aria-label="Quick questions"
      className={classes(
        "flex min-h-0 min-w-0 flex-col overflow-clip border bg-surface",
        sheet
          ? "sticky bottom-0 z-10 -mx-4 max-h-[72dvh] rounded-t-sheet shadow-raised"
          : "rounded-card md:h-full",
      )}
    >
      {sheet && (
        <span aria-hidden className="mt-2.5 h-1 w-9 shrink-0 self-center rounded-full bg-input" />
      )}
      <header className="flex shrink-0 items-center justify-between gap-3 py-3 pr-3 pl-4 shadow-divide">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-interface font-bold">Quick questions</h2>
          <p className="truncate text-meta text-muted-foreground">
            {props.model === undefined ? "" : `${props.model} · `}reads the PR, changes nothing
          </p>
        </div>
        <IconButton
          label="Close quick questions"
          icon={<X />}
          look="disc"
          onClick={props.onClose}
        />
      </header>
      <Scroller ref={conversation} className="flex min-h-0 flex-1 flex-col gap-3.5 px-4 py-3.5">
        {props.asked.map((one, index) => (
          // A conversation only grows, so each keeps its place.
          // biome-ignore lint/suspicious/noArrayIndexKey: asked in this order, never moved
          <div key={index} className="flex flex-col gap-2.5">
            <Question text={one.question} />
            <div className="text-interface">
              <Answer text={one.answer} running={false} replayed={one.answer.length} compact />
            </div>
            {one.lines.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {one.lines.map((line) => (
                  <Button
                    key={`${line.path}:${line.line}`}
                    variant="reply"
                    size="xs"
                    title={`Show ${line.path}, line ${line.line}, in the diff`}
                    onClick={() => props.onPoint(line)}
                  >
                    {nameOf(line.path)} · line {line.line}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ))}
        {pending !== undefined && (
          <div className="flex flex-col gap-2.5">
            <Question text={pending} />
            <p className="text-interface text-muted-foreground">Reading the PR…</p>
          </div>
        )}
      </Scroller>
      {props.foot !== undefined && (
        <div className="shrink-0 border-t px-4 pt-2.5 pb-3">{props.foot}</div>
      )}
    </section>
  );
}

/** The owner's question, on the right, as theirs. */
const Question = (props: { text: string }) => (
  <p className="max-w-[85%] self-end rounded-bubble bg-muted px-3.5 py-2 text-interface font-semibold wrap-anywhere">
    {props.text}
  </p>
);
