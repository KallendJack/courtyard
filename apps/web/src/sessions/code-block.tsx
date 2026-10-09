import { TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { type CodeLanguage, codeLanguage } from "./code-languages.ts";

type Highlighter = typeof import("./highlight.tsx");

/** The highlighter once it has loaded, so later blocks colour their code at once. */
let highlighter: Highlighter | undefined;

/**
 * Whether code in `language` can be coloured yet: loads the highlighter and the language's
 * grammar the first time a block needs them.
 */
const useColouring = (language: CodeLanguage | undefined) => {
  const id = language?.id;
  const [ready, setReady] = useState(() =>
    id !== undefined && highlighter?.knows(id) ? id : undefined,
  );
  const grammar = language?.grammar;
  useEffect(() => {
    if (id === undefined || grammar === undefined) return;
    let current = true;
    void import("./highlight.tsx")
      .then(async (loaded) => {
        await loaded.loadLanguage(id, grammar);
        highlighter = loaded;
      })
      .then(() => current && setReady(id))
      // Uncoloured code reads just as well: a grammar that didn't load leaves it so.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [id, grammar]);
  return ready !== undefined && ready === id ? highlighter : undefined;
};

/**
 * A code block in an answer: a top bar naming its language with a Copy button that copies just
 * the code, over the code in the system's monospace font, coloured by its language once the
 * highlighter has loaded. With a problem, it's a rich block that couldn't be drawn (ADR 0021):
 * the top bar says so instead, over what the model wrote.
 */
export function CodeBlock(props: {
  /** What's written after the fence ("python"), if anything. */
  language: string | undefined;
  code: string;
  /** Why this shows as code: "Couldn't draw this chart, so here's what the model wrote". */
  problem?: string;
}) {
  const language = codeLanguage(props.language);
  const name = language?.name ?? "Code";
  const colouring = useColouring(language);
  const id = language?.id;
  const coloured = useMemo(
    () =>
      colouring !== undefined && id !== undefined
        ? colouring.colourCode(id, props.code)
        : undefined,
    [colouring, id, props.code],
  );
  return (
    <figure aria-label={props.problem ?? name} className="overflow-clip rounded-md border bg-field">
      {props.problem === undefined ? (
        <div className="flex items-center justify-between gap-2 border-b py-0.5 pr-1 pl-3 md:py-1 md:pr-1.5">
          <span className="truncate text-xs text-muted-foreground">{name}</span>
          <CopyButton look="labelled" label="Copy code" text={() => props.code} />
        </div>
      ) : (
        <figcaption className="flex items-center gap-2 border-b bg-background px-3 py-2 text-xs font-semibold text-muted-foreground">
          <TriangleAlert aria-hidden className="size-[15px] shrink-0" />
          {props.problem}
        </figcaption>
      )}
      <pre className="overflow-x-auto p-3 font-mono text-xs/[21px] md:text-sm/[22px]">
        <code>{coloured ?? props.code}</code>
      </pre>
    </figure>
  );
}
