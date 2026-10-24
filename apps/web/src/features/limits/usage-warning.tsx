import type { ModelRef, ProviderId } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { describeProblem } from "../../components/layout/problems.tsx";
import { keepUsage, putOffWarning, useUsage } from "./api.ts";
import { resetsWords, switchWords, warningWords } from "./words.ts";

/**
 * The warning before a limit, above the Reply box (#66; Paper, "Tablet · Session: warning before a
 * limit (#66)"), while the session's model is on a provider the worker warns of: how full its
 * fullest window is and when it resets, in gold, as what needs the owner. Not now puts it off on
 * every screen until the window resets or passes 95%; Switch sends the next message to the other
 * provider's default model, as Carry on does after a limit, there only when one is connected with
 * room. Nothing for a provider with room.
 */
export function UsageWarningCard(props: {
  /** The provider the session's next message goes to. */
  provider: ProviderId | undefined;
  /** Switch: the box's model becomes this one. */
  onSwitch: (model: ModelRef) => void;
}) {
  const usage = useUsage();
  const warning = usage?.warnings.find((each) => each.provider === props.provider);
  const notNow = useAction(async () => {
    if (warning === undefined) return undefined;
    const put = await putOffWarning(warning.provider);
    if (put.kind !== "loaded") return describeProblem(put).body;
    keepUsage(put.data);
    return undefined;
  });
  if (warning === undefined) return null;
  const resets = resetsWords(warning.resetAt, { first: true });
  const { switchTo } = warning;
  return (
    <section
      aria-label="Near a usage limit"
      className="mb-2.5 flex items-center gap-x-4 gap-y-3 rounded-card border border-warning/25 bg-warning/8 py-3 pr-3 pl-4 max-sm:flex-col max-sm:items-stretch"
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning max-sm:hidden" />
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <p className="text-interface font-bold text-foreground">{warningWords(warning)} used</p>
        <p className="text-meta font-medium text-warning">
          {[resets, switchTo === undefined ? undefined : "switch before it stops mid-turn"]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <FormError message={notNow.error} />
      </div>
      <div className="flex shrink-0 items-center gap-2 max-sm:flex-row-reverse">
        <Button
          variant="outline"
          busy={notNow.busy}
          busyLabel="Not now…"
          onClick={() => void notNow.run()}
        >
          Not now
        </Button>
        {switchTo !== undefined && (
          <Button variant="needs" grow onClick={() => props.onSwitch(switchTo.model)}>
            {switchWords(switchTo)}
          </Button>
        )}
      </div>
    </section>
  );
}
