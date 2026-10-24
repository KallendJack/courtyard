import { Button, IconButton } from "@courtyard/ui/buttons/button.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { useDock } from "@courtyard/ui/frame/handheld.ts";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { ArrowUp } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

/**
 * The slim ask line (#278; Paper, "PR page: checks passed, ask line"): one line to ask or say
 * anything, with quick asks beside it that send with one tap, for a page where the full message
 * box would be too much (a pull request's). It sends on the model already in use, so it has no
 * model, effort, skill or attach controls. On a touch screen the Talk key and the talk strip fill
 * it in. Its classes are off the first load, in review.css with the page that uses it.
 */
export function AskLine(props: {
  /** The line's name: "Ask about this PR". */
  label: string;
  /** What it asks about, as its placeholder: "Ask about this PR…". */
  placeholder: string;
  /** The quick asks, each sent as it reads. */
  quick: readonly string[];
  /**
   * Actions beside the quick asks that send nothing, such as Fix it in a session (#327). One that's
   * `busy` shows it's working with its `busyLabel`, and the rest of the line waits (#330).
   */
  actions?: readonly {
    readonly label: string;
    readonly run: () => void;
    readonly busy?: boolean;
    readonly busyLabel?: string;
  }[];
  /** Sends what was asked: an error to show, or nothing once it's gone. */
  ask: (text: string) => Promise<string | undefined>;
}) {
  const [text, setText] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const typed = useRef(text);
  typed.current = text;
  const dock = useDock();
  const asking = useAction(async (words: string) => {
    const problem = await props.ask(words);
    if (problem === undefined && words === typed.current.trim()) setText("");
    return problem;
  });

  // The Talk key and the talk strip put what's said here, after anything typed (#206).
  useEffect(
    () =>
      dock?.offerField({
        focus: () => field.current?.focus(),
        answering: false,
        dictate: () => {
          const before = typed.current;
          const put = (words: string) =>
            setText(
              words === "" ? before : before.trim() === "" ? words : `${before.trimEnd()} ${words}`,
            );
          return { hear: put, drop: () => put(""), done: () => {} };
        },
      }),
    [dock],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const words = text.trim();
    if (words !== "") void asking.run(words);
  };
  // What's working: a quick ask (its button shows it), something typed (Ask shows it), or an action.
  const asked = asking.running?.[0];
  const quickAsked = asked !== undefined && props.quick.includes(asked);
  const acting = props.actions?.some((action) => action.busy === true) === true;
  const working = asking.busy || acting;

  return (
    <div className="flex flex-col gap-1.5">
      <form
        onSubmit={submit}
        className="flex min-h-12 flex-wrap items-center gap-2 rounded-lg border border-input bg-surface py-1.5 pr-1.5 pl-4 xl:min-h-14 xl:rounded-card xl:pr-2 xl:pl-4.5"
      >
        <input
          ref={field}
          aria-label={props.label}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={props.placeholder}
          disabled={acting}
          enterKeyHint="send"
          className="h-9 min-w-40 flex-1 bg-transparent text-interface font-medium text-foreground outline-none disabled:opacity-50"
        />
        {props.quick.map((quick) => (
          <Button
            key={quick}
            variant="outline"
            size="sm"
            busy={asked === quick}
            busyLabel="Asking…"
            waiting={working && asked !== quick}
            onClick={() => void asking.run(quick)}
          >
            {quick}
          </Button>
        ))}
        {props.actions?.map((action) => (
          <Button
            key={action.label}
            variant="outline"
            size="sm"
            busy={action.busy === true}
            busyLabel={action.busyLabel ?? action.label}
            waiting={working && action.busy !== true}
            onClick={action.run}
          >
            {action.label}
          </Button>
        ))}
        <IconButton
          type="submit"
          label="Ask"
          icon={<ArrowUp />}
          look="filled"
          busy={asking.busy && !quickAsked}
          busyLabel="Asking…"
          waiting={acting || quickAsked}
          disabled={text.trim() === ""}
        />
      </form>
      <FormError message={asking.error} />
    </div>
  );
}
