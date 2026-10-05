import type { ModelRef, NewMessage, ProviderList } from "@courtyard/contract";
import { type FormEvent, memo, useState } from "react";

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
    <form onSubmit={submit} className="space-y-2">
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
        rows={2}
        className="block w-full resize-none rounded-md border border-neutral-300 px-3 py-2"
      />
      <div className="flex items-center gap-2">
        <select
          aria-label="Model"
          value={modelKey}
          onChange={(event) => setChosenKey(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        >
          {models.length === 0 && <option value="">No models available</option>}
          {models.map((m) => (
            <option key={keyOf(m.ref)} value={keyOf(m.ref)}>
              {m.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={sending || props.disabled || models.length === 0}
          className="shrink-0 rounded-md bg-neutral-900 px-4 py-1.5 font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </div>
      {props.providers.flatMap((provider) =>
        provider.available
          ? []
          : [
              <p key={provider.id} className="text-xs text-amber-800">
                {provider.label} isn't available: {provider.reason}
              </p>,
            ],
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
});
