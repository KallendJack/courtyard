import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { WebLink } from "../buttons/web-link.tsx";
import { Scroller } from "../layout/scroller.tsx";
import { classes } from "../lib/classes.ts";
import { textOf } from "./hast.ts";
import {
  MarkdownCell,
  MarkdownHeading,
  MarkdownRow,
  MarkdownRows,
  MarkdownTable,
} from "./table.tsx";

const SUBHEADING = "display-section text-xl/7";

/**
 * How each part of an answer looks, in both apps (#753). Markdown becomes elements, never raw
 * HTML, so an answer can't inject anything into the page. Headings start at h2, under the page's
 * own title. A fence is plain code here; the web app draws its own (`answer.tsx`).
 */
export const MARKDOWN_ELEMENTS: Components = {
  h1: ({ node: _, ...props }) => <h2 className={SUBHEADING} {...props} />,
  h2: ({ node: _, ...props }) => <h3 className={SUBHEADING} {...props} />,
  h3: ({ node: _, ...props }) => <h4 className="display-section text-lg/7" {...props} />,
  h4: ({ node: _, ...props }) => <h5 className="font-semibold" {...props} />,
  h5: ({ node: _, ...props }) => <h6 className="font-semibold" {...props} />,
  h6: ({ node: _, ...props }) => <h6 className="font-semibold" {...props} />,
  ol: ({ node: _, ...props }) => (
    <ol
      className="list-decimal space-y-2 pl-6 marker:font-semibold marker:text-primary-text"
      {...props}
    />
  ),
  ul: ({ node: _, ...props }) => (
    <ul className="list-disc space-y-2 pl-6 marker:text-primary-text" {...props} />
  ),
  a: ({ node: _, className: __, ...props }) => <WebLink {...props} />,
  // An image is shown as a link, never loaded by itself: a model tricked by something it read
  // could otherwise put data in an image's address and send it away without anyone clicking.
  img: ({ src, alt }) => (
    <WebLink href={typeof src === "string" ? src : undefined}>{alt || "Image"}</WebLink>
  ),
  code: ({ node: _, className: __, ...props }) => (
    <code className="rounded-sm bg-muted px-1 py-0.5 text-code" {...props} />
  ),
  pre: ({ node }) => (
    <div className="rounded-md border bg-field">
      <Scroller as="pre" axis="x" className="px-3.5 py-3 font-mono text-meta">
        {textOf(node).replace(/\n$/, "")}
      </Scroller>
    </div>
  ),
  blockquote: ({ node: _, ...props }) => (
    <blockquote
      className="border-l-2 border-primary-text/40 pl-4 text-muted-foreground"
      {...props}
    />
  ),
  // Every table sorts by its columns (ADR 0021).
  table: MarkdownTable,
  th: MarkdownHeading,
  tbody: MarkdownRows,
  tr: MarkdownRow,
  td: MarkdownCell,
};

/** GitHub's Markdown: tables, struck-through words, task lists and bare links. */
export const MARKDOWN_PLUGINS = [remarkGfm];

/**
 * A finished answer, formatted as Courtyard's session formats one (#753): its paragraphs, lists,
 * links and sortable tables. Long words and links wrap, so it never pushes its column sideways.
 */
export const MarkdownAnswer = memo(function MarkdownAnswer(props: {
  text: string;
  className?: string;
}) {
  return (
    <div className={classes("flex flex-col gap-4 wrap-anywhere", props.className)}>
      <Markdown remarkPlugins={MARKDOWN_PLUGINS} components={MARKDOWN_ELEMENTS}>
        {props.text}
      </Markdown>
    </div>
  );
});
