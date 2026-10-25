import { TOOLS_SAID_MAX_CHARACTERS, type ToolPick } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { type Listening, listen } from "@courtyard/ui/frame/speech.ts";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { Mic, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { hearTools } from "@/api/fabrication";

/** What the owner can say, as the board has it. */
const EXAMPLE = `"A hand saw, the Workmate, a square and two clamps."`;

/**
 * "Or just say it" (#707): the owner says or types the tools they have, a model ticks them, and
 * they check the tiles before Save. Nothing here saves anything.
 */
export function SayIt(props: { onHeard: (tools: readonly ToolPick[]) => void }) {
  const [said, setSaid] = useState("");
  const [listening, setListening] = useState<Listening>();
  const [problem, setProblem] = useState<string>();
  useEffect(() => () => listening?.cancel(), [listening]);

  const tick = useAction(async (words: string) => {
    const heard = await hearTools(words);
    if (heard.kind === "failed") return heard.message;
    if (heard.kind !== "loaded") return "Can't reach Courtyard's worker. Tick your tools instead.";
    props.onHeard(heard.data.tools);
    setSaid("");
    return undefined;
  });

  const talk = () => {
    if (listening !== undefined) {
      listening.finish();
      return;
    }
    setProblem(undefined);
    const before = said.trim();
    const joined = (words: string) => [before, words].filter((part) => part !== "").join(" ");
    setListening(
      listen({
        heard: (words) => setSaid(joined(words)),
        finished: (words) => {
          setListening(undefined);
          const all = joined(words);
          setSaid(all);
          if (all !== "") void tick.run(all);
        },
        failed: (why, words) => {
          setListening(undefined);
          setSaid(joined(words));
          setProblem(why);
        },
      }),
    );
  };

  return (
    <section
      aria-labelledby="say-it"
      className="flex flex-col gap-2.5 rounded-bubble bg-secondary p-3.5"
    >
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={talk}
          aria-label={listening === undefined ? "Say your tools" : "Stop listening"}
          aria-pressed={listening !== undefined}
          className={classes(
            "flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            listening !== undefined && "animate-pulse",
          )}
        >
          {listening === undefined ? (
            <Mic aria-hidden className="size-4.5" />
          ) : (
            <Square aria-hidden className="size-3.5 fill-current" />
          )}
        </button>
        <h2 id="say-it" className="text-interface font-semibold text-foreground">
          Or just say it
        </h2>
      </div>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (said.trim() !== "") void tick.run(said);
        }}
      >
        <label className="sr-only" htmlFor="said">
          Your tools, in your words
        </label>
        <textarea
          id="said"
          rows={2}
          value={said}
          maxLength={TOOLS_SAID_MAX_CHARACTERS}
          onChange={(event) => setSaid(event.target.value)}
          placeholder={EXAMPLE}
          className="resize-none rounded-md border border-input bg-field px-2.5 py-2 text-meta text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {said.trim() === "" ? (
          <p className="text-meta text-muted-foreground">It ticks them for you to check.</p>
        ) : (
          <Button
            type="submit"
            variant="soft"
            size="sm"
            busy={tick.busy}
            busyLabel="Ticking…"
            disabled={listening !== undefined}
          >
            Tick them
          </Button>
        )}
        <FormError message={problem ?? tick.error} />
      </form>
    </section>
  );
}
