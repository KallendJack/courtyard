import type { Effort, ModelRef, NewMessage, ProviderList } from "@courtyard/contract";
import { ArrowUp, Square } from "lucide-react";
import { type FormEvent, memo, useState } from "react";
import { Button } from "@/components/button";
import { Chip } from "@/components/chip";
import { FormError } from "@/components/form-error";
import { Sheet } from "@/components/sheet";
import { classes } from "@/lib/classes";
import { useAction } from "@/lib/use-action";
import { choiceSummary, ModelPickers, useModelChoice } from "./model-pickers.tsx";
import { availableModels } from "./models.ts";

/**
 * A message box with model and effort pickers. `send` returns an error to show, or nothing on
 * success. Memoised: it doesn't re-render while an answer streams in above it.
 */
export const Composer = memo(function Composer(props: {
  providers: ProviderList["providers"];
  /** The session's last model and effort, which the pickers follow until the owner picks. */
  initialModel?: ModelRef;
  initialEffort?: Effort;
  disabled?: boolean;
  /** While a turn runs: stops it, shown in place of Send. */
  stop?: () => void;
  placeholder: string;
  /** The button's name; "Send" unless the box starts something. */
  submitLabel?: string;
  /**
   * One line with a round button on a narrow screen (a session, where the model carries on), the
   * model and effort in a chip above it that opens a sheet.
   */
  compactOnNarrow?: boolean;
  send: (message: NewMessage) => Promise<string | undefined>;
}) {
  const models = availableModels(props.providers);
  const choice = useModelChoice({
    models,
    followModel: props.initialModel,
    followEffort: props.initialEffort,
  });
  const [choosing, setChoosing] = useState(false);
  const [text, setText] = useState("");
  const send = useAction(props.send);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const { model, effort } = choice;
    if (!model) return send.setError("No model is available. Check the providers' settings.");
    if (text.trim() === "") return;
    const message = { text, model: model.ref, ...(effort === undefined ? {} : { effort }) };
    if (await send.run(message)) setText("");
  };

  const label = props.stop ? "Stop" : (props.submitLabel ?? "Send");
  // On a narrow screen a session's box is one line with a round button, and the chip above it
  // opens the pickers in a sheet; beside the box they're there from tablet width up.
  const compact = props.compactOnNarrow === true;

  return (
    <div className="flex flex-col gap-1.5">
      {compact && (
        <>
          <Chip narrowOnly onClick={() => setChoosing(true)}>
            {choiceSummary(choice)}
          </Chip>
          <Sheet title="Model for this session" open={choosing} onClose={() => setChoosing(false)}>
            <ModelPickers models={models} choice={choice} look="field" />
          </Sheet>
        </>
      )}
      <form
        onSubmit={submit}
        className={classes(
          "flex flex-col gap-2 rounded-lg border bg-field px-3 pt-2.5 pb-2 shadow-xs focus-within:border-primary-text focus-within:ring-3 focus-within:ring-accent md:px-4 md:pt-3.5 md:pb-3",
          compact &&
            "max-md:flex-row max-md:items-center max-md:rounded-full max-md:py-1.5 max-md:pr-1.5 max-md:pl-4",
        )}
      >
        <textarea
          aria-label="Message"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={props.placeholder}
          rows={1}
          // One line to start, growing with what's typed, so the keyboard keeps its room.
          className="block max-h-48 min-h-6 w-full flex-1 resize-none bg-transparent text-base/6 outline-none field-sizing-content md:min-h-12"
        />
        <div className="flex items-center gap-2">
          <ModelPickers models={models} choice={choice} look="pill" wideOnly={compact} />
          <span className={classes("flex-1", compact && "max-md:hidden")} />
          <Button
            {...(props.stop
              ? { variant: "outline", onClick: props.stop }
              : { type: "submit", disabled: send.busy || props.disabled || models.length === 0 })}
            {...(compact
              ? { narrowIcon: props.stop ? <Square className="fill-current" /> : <ArrowUp /> }
              : {})}
          >
            {props.stop && <Square className="fill-current" />}
            {label}
          </Button>
        </div>
      </form>
      {props.providers.flatMap((provider) =>
        provider.available
          ? []
          : [
              <p key={provider.id} className="text-xs text-muted-foreground">
                {provider.label} isn't available: {provider.reason}
              </p>,
            ],
      )}
      <FormError message={send.error} />
    </div>
  );
});
