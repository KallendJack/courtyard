import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * How each part of an answer looks. Markdown is rendered to elements, never as raw HTML, so an
 * answer can't inject anything into the page.
 */
const ELEMENTS: Components = {
  h1: ({ node: _, ...props }) => <h3 className="font-display text-xl/7 font-semibold" {...props} />,
  h2: ({ node: _, ...props }) => <h3 className="font-display text-xl/7 font-semibold" {...props} />,
  h3: ({ node: _, ...props }) => <h4 className="font-display text-lg/7 font-semibold" {...props} />,
  h4: ({ node: _, ...props }) => <h5 className="font-semibold" {...props} />,
  ol: ({ node: _, ...props }) => (
    <ol
      className="list-decimal space-y-2 pl-6 marker:font-semibold marker:text-primary-text"
      {...props}
    />
  ),
  ul: ({ node: _, ...props }) => (
    <ul className="list-disc space-y-2 pl-6 marker:text-primary-text" {...props} />
  ),
  a: ({ node: _, href, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-primary-text underline underline-offset-2"
      {...props}
    />
  ),
  code: ({ node: _, className: __, ...props }) => (
    <code
      className="rounded-sm bg-muted px-1 py-0.5 text-[0.9em] [pre_&]:bg-transparent [pre_&]:p-0"
      {...props}
    />
  ),
  pre: ({ node: _, ...props }) => (
    <pre className="overflow-x-auto rounded-md border bg-field p-3 text-sm/6" {...props} />
  ),
  blockquote: ({ node: _, ...props }) => (
    <blockquote
      className="border-l-2 border-primary-text/40 pl-4 text-muted-foreground"
      {...props}
    />
  ),
  table: ({ node: _, ...props }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  th: ({ node: _, ...props }) => (
    <th className="border-b px-2 py-1.5 text-left font-semibold" {...props} />
  ),
  td: ({ node: _, ...props }) => <td className="border-b px-2 py-1.5" {...props} />,
};

/**
 * A model's answer, formatted. Memoised on the text, so an answer only re-renders when it
 * changes (each new piece while it streams in).
 */
export const Answer = memo(function Answer(props: { text: string }) {
  return (
    <div className="space-y-4 text-base/[26px] wrap-anywhere">
      <Markdown remarkPlugins={[remarkGfm]} components={ELEMENTS}>
        {props.text}
      </Markdown>
    </div>
  );
});
