import type { ModelRef, NewMessage, ProviderList } from "@courtyard/contract";
import { ArrowUp, Square } from "lucide-react";
import { type FormEvent, memo, useState } from "react";
import { PillButton } from "@/components/pill-button";

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
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const model = models.find((m) => keyOf(m.ref) === modelKey)?.ref;
    if (!model) return setError("No model is available. Check the providers' settings.");
    if (text.trim() === "") return;
    setSending(true);
    const problem = await props.send({ text, model });
    setSending(false);
    setError(problem);
    if (!problem) setText("");
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-2 rounded-lg border bg-field px-3 pt-2.5 pb-2 shadow-xs focus-within:border-primary-text/60 md:px-4 md:pt-3.5 md:pb-3"
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
        className="block max-h-48 min-h-6 w-full resize-none bg-transparent text-base/6 outline-none field-sizing-content md:min-h-12"
      />
      <div className="flex items-center gap-2">
        <select
          aria-label="Model"
          value={modelKey}
          onChange={(event) => setChosenKey(event.target.value)}
          className="min-w-0 max-w-56 truncate rounded-full bg-background px-3 py-1.5 text-[13px] font-medium text-muted-foreground"
        >
          {models.length === 0 && <option value="">No models available</option>}
          {models.map((m) => (
            <option key={keyOf(m.ref)} value={keyOf(m.ref)}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="flex-1" />
        {props.stop ? (
          <PillButton type="button" variant="outline" onClick={props.stop}>
            <Square className="fill-current" />
            Stop
          </PillButton>
        ) : (
          <PillButton type="submit" disabled={sending || props.disabled || models.length === 0}>
            <ArrowUp className="md:hidden" />
            Send
          </PillButton>
        )}
      </div>
      {props.providers.flatMap((provider) =>
        provider.available
          ? []
          : [
              <p key={provider.id} className="text-[13px] text-muted-foreground">
                {provider.label} isn't available: {provider.reason}
              </p>,
            ],
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </form>
  );
});
