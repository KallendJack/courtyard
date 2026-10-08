import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { finishForNow, splitBlocks } from "./blocks.ts";
import { useReveal } from "./reveal.ts";

const SUBHEADING = "font-display text-xl/7 font-semibold";
const LINK = "font-medium text-primary-text underline underline-offset-2";

/**
 * How each part of an answer looks. Markdown becomes elements, never raw HTML, so an answer can't
 * inject anything into the page. Headings start at h2, under the session's own title.
 */
const ELEMENTS: Components = {
  h1: ({ node: _, ...props }) => <h2 className={SUBHEADING} {...props} />,
  h2: ({ node: _, ...props }) => <h3 className={SUBHEADING} {...props} />,
  h3: ({ node: _, ...props }) => <h4 className="font-display text-lg/7 font-semibold" {...props} />,
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
  a: ({ node: _, href, ...props }) => (
    <a href={href} target="_blank" rel="noreferrer" className={LINK} {...props} />
  ),
  // An image is shown as a link, never loaded by itself: a model tricked by something it read
  // could otherwise put data in an image's address and send it away without anyone clicking.
  img: ({ src, alt }) => (
    <a
      href={typeof src === "string" ? src : undefined}
      target="_blank"
      rel="noreferrer"
      className={LINK}
    >
      {alt || "Image"}
    </a>
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

const PLUGINS = [remarkGfm];

/** One block of an answer, memoised on its text, so finished blocks aren't formatted again. */
const Block = memo(function Block(props: { text: string }) {
  return (
    <Markdown remarkPlugins={PLUGINS} components={ELEMENTS}>
      {props.text}
    </Markdown>
  );
});

/**
 * A model's answer, formatted. While it streams it's revealed at an even pace, and only its last
 * block is formatted again as text arrives, shown with any half-written formatting closed.
 */
export const Answer = memo(function Answer(props: {
  text: string;
  /** The turn is still running, so more text may come. */
  running: boolean;
  /** How much of the text was replayed from the event log, which shows at once. */
  replayed: number;
}) {
  const shown = useReveal(props.text, { running: props.running, replayed: props.replayed });
  const blocks = splitBlocks(shown);
  return (
    <div className="space-y-4 text-base/[26px] wrap-anywhere">
      {blocks.map((block, index) => (
        <Block
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks only grow, in order (a definition arriving makes the answer one block, which just draws it again)
          key={index}
          text={props.running && index === blocks.length - 1 ? finishForNow(block) : block}
        />
      ))}
    </div>
  );
});
