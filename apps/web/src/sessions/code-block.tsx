import { CopyButton } from "@/components/copy-button";
import { codeLanguage } from "./code-languages.ts";

/**
 * A code block in an answer: a top bar naming its language with a Copy button that copies just
 * the code, over the code in the system's monospace font.
 */
export function CodeBlock(props: {
  /** What's written after the fence ("python"), if anything. */
  language: string | undefined;
  code: string;
}) {
  const language = codeLanguage(props.language);
  const name = language?.name ?? "Code";
  return (
    <figure aria-label={name} className="overflow-clip rounded-md border bg-field">
      <div className="flex items-center justify-between gap-2 border-b py-0.5 pr-1 pl-3 md:py-1 md:pr-1.5">
        <span className="truncate text-xs text-muted-foreground">{name}</span>
        <CopyButton look="labelled" label="Copy code" text={() => props.code} />
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs/[21px] md:text-sm/[22px]">
        <code>{props.code}</code>
      </pre>
    </figure>
  );
}
