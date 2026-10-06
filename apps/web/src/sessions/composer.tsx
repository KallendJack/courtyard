import type { ModelRef, NewMessage, ProviderList } from "@courtyard/contract";
import { ArrowUp, Square } from "lucide-react";
import { type FormEvent, memo, useState } from "react";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { classes } from "@/lib/classes";
import { useAction } from "@/lib/use-action";

const keyOf = (model: ModelRef) => `${model.provider}/${model.model}`;

/** Every model the available providers offer, in order. */
export const availableModels = (providers: ProviderList["providers"]) =>
  providers.flatMap((provider) =>
    provider.available
      ? provider.models.map((model) => ({
          ref: { provider: provider.id, model: model.id },
          label: model.label,
        }))
      : [],
  );

/**
 * A message box with a model picker. `send` returns an error to show, or nothing on success.
 * Memoised: it doesn't re-render while an answer streams in above it.
 */
export const Composer = memo(function Composer(props: {
  providers: ProviderList["providers"];
  initialModel?: ModelRef;
  disabled?: boolean;
  /** While a turn runs: stops it, shown in place of Send. */
  stop?: () => void;
  placeholder: string;
  /** The button's name; "Send" unless the box starts something. */
  submitLabel?: string;
  /** One line with a round button on a narrow screen (a session, where the model carries on). */
  compactOnNarrow?: boolean;
  send: (message: NewMessage) => Promise<string | undefined>;
}) {
  const models = availableModels(props.providers);
  // Until the owner picks one, follow the session's last model (it arrives once the event log
  // has replayed), else the first available.
  const [chosenKey, setChosenKey] = useState<string>();
  const followed = props.initialModel ? keyOf(props.initialModel) : undefined;
  const firstKey = models[0] ? keyOf(models[0].ref) : "";
  const followedKey = models.some((m) => keyOf(m.ref) === followed) ? followed : undefined;
  const modelKey = chosenKey ?? followedKey ?? firstKey;
  const [text, setText] = useState("");
  const send = useAction(props.send);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const model = models.find((m) => keyOf(m.ref) === modelKey)?.ref;
    if (!model) return send.setError("No model is available. Check the providers' settings.");
    if (text.trim() === "") return;
    if (await send.run({ text, model })) setText("");
  };

  const label = props.stop ? "Stop" : (props.submitLabel ?? "Send");
  // On a narrow screen a session's box is one line with a round button, the model following the
  // session's last one; the picker is there from tablet width up.
  const compact = props.compactOnNarrow === true;

  return (
    <div className="space-y-1.5">
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
          <select
            aria-label="Model"
            value={modelKey}
            onChange={(event) => setChosenKey(event.target.value)}
            className={classes(
              "min-w-0 max-w-56 truncate rounded-full bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground",
              compact && "max-md:hidden",
            )}
          >
            {models.length === 0 && <option value="">No models available</option>}
            {models.map((m) => (
              <option key={keyOf(m.ref)} value={keyOf(m.ref)}>
                {m.label}
              </option>
            ))}
          </select>
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
