import type { Doing } from "@courtyard/contract";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/buttons/button";
import { OptionsMenu } from "@/components/buttons/options-menu";
import { FormError } from "@/components/forms/form-error";
import { useAction } from "@/hooks/use-action";
import { clockWords } from "../../../lib/when.ts";
import type { Turn } from "./events.ts";

/** What the turn was doing as it was cut off, as the card says it: "running pnpm test". */
const doingWords = (doing: Doing) => {
  switch (doing.kind) {
    case "thinking":
    case "waiting-for-place":
      return undefined;
    case "writing":
      return "writing its answer";
    case "activity": {
      const { activity } = doing;
      switch (activity.kind) {
        case "ran-command":
          return `running ${activity.command}`;
        case "edited-file":
          return `editing ${activity.path}`;
        case "read-file":
          return `reading ${activity.path}`;
        case "skill-loaded":
          return `loading the ${activity.name} skill`;
        case "skill-file-read":
          return `reading the ${activity.name} skill`;
        case "web-searched":
          return "searching the web";
        case "page-read":
          return `reading ${activity.site}`;
        case "waiting-for-build":
          return "waiting for the machine's builds";
        case "updated-tasks":
          return "updating its task list";
        case "check-failed":
          return `fixing ${activity.name}`;
        case "used-tool":
          return `using ${activity.connection}`;
      }
    }
  }
};

/**
 * A turn a restart cut off (#186; Paper, "Tablet · Session: turn cut off, Continue" and
 * "Component · Cut-off turn: cover, desktop, push"): when Courtyard restarted, what the turn was
 * doing, and on the session's last turn Continue, a new turn told to carry on from there and
 * check what already happened, with Start again (the old Retry) under ⋯. In gold, as what needs
 * the owner; on the cover screen, its buttons under its words.
 */
export function CutOffCard(props: {
  turn: Turn;
  /** When it was cut off: the restart. */
  at: string;
  /** Continue, on the session's last turn: an error to show, or nothing once it's on its way. */
  onContinue?: (turn: Turn) => Promise<string | undefined>;
  /** Start again: the turn's message sent again, from scratch; not for one of only attachments. */
  onStartAgain?: (turn: Turn) => void;
}) {
  const { turn, onContinue, onStartAgain } = props;
  const go = useAction(async () => onContinue?.(turn));
  const doing = doingWords(turn.doing);
  const when = clockWords(props.at);
  return (
    <section
      aria-label="Cut off"
      className="flex items-center gap-x-4 gap-y-3 rounded-card border border-warning/25 bg-warning/8 py-3.5 pr-3.5 pl-4 max-sm:flex-col max-sm:items-stretch"
    >
      <div className="flex min-w-0 grow flex-col gap-1">
        <p className="text-interface font-bold text-warning">
          Cut off · <span className="max-sm:hidden">Courtyard </span>restarted at {when}
        </p>
        <p className="text-meta font-medium text-muted-foreground">
          {doing === undefined ? "It stopped partway through." : `It stopped while ${doing}.`}
          {onContinue !== undefined && (
            <>
              {" "}
              Continue picks up from there
              <span className="max-sm:hidden"> and checks what already happened</span>.
            </>
          )}
        </p>
        <FormError message={go.error} />
      </div>
      {onContinue !== undefined && (
        <div className="flex shrink-0 items-center gap-2 max-sm:flex-row-reverse">
          {onStartAgain !== undefined && (
            <OptionsMenu
              label="More for this turn"
              menuLabel="This turn"
              width={260}
              choices={[
                {
                  icon: <RotateCcw />,
                  name: "Start again",
                  note: "Sends your message again, from scratch",
                  onPick: () => onStartAgain(turn),
                },
              ]}
            />
          )}
          <Button
            size="lg"
            busy={go.busy}
            busyLabel="Continuing…"
            onClick={() => void go.run()}
            grow
          >
            Continue
          </Button>
        </div>
      )}
    </section>
  );
}
