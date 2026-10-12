import { ArrowUp } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useAction } from "@/lib/use-action";
import { Button, IconButton } from "./button.tsx";
import { FormError } from "./form-error.tsx";
import { useDock } from "./handheld.ts";

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
  /** Sends what was asked: an error to show, or nothing once it's gone. */
  ask: (text: string) => Promise<string | undefined>;
  disabled?: boolean;
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
  const off = props.disabled === true || asking.busy;

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
          disabled={props.disabled}
          enterKeyHint="send"
          className="h-9 min-w-40 flex-1 bg-transparent text-interface font-medium text-foreground outline-none disabled:opacity-50"
        />
        {props.quick.map((quick) => (
          <Button
            key={quick}
            variant="outline"
            size="sm"
            disabled={off}
            onClick={() => void asking.run(quick)}
          >
            {quick}
          </Button>
        ))}
        <IconButton
          type="submit"
          label="Ask"
          icon={<ArrowUp />}
          look="filled"
          disabled={off || text.trim() === ""}
        />
      </form>
      <FormError message={asking.error} />
    </div>
  );
}
