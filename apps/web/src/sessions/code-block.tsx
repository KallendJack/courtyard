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
 * highlighter has loaded.
 */
export function CodeBlock(props: {
  /** What's written after the fence ("python"), if anything. */
  language: string | undefined;
  code: string;
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
    <figure aria-label={name} className="overflow-clip rounded-md border bg-field">
      <div className="flex items-center justify-between gap-2 border-b py-0.5 pr-1 pl-3 md:py-1 md:pr-1.5">
        <span className="truncate text-xs text-muted-foreground">{name}</span>
        <CopyButton look="labelled" label="Copy code" text={() => props.code} />
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs/[21px] md:text-sm/[22px]">
        <code>{coloured ?? props.code}</code>
      </pre>
    </figure>
  );
}
