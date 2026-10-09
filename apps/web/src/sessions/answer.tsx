import { memo, useEffect, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { finishForNow, splitBlocks } from "./blocks.ts";
import { CodeBlock } from "./code-block.tsx";
import { hasMaths, writeMathsForRemark } from "./maths.ts";
import { useReveal } from "./reveal.ts";

/** A node of formatted Markdown, as far as reading its text needs. */
type Node = { readonly value?: string; readonly children?: readonly Node[] };

/** All the text in a node, as written. */
const textOf = (node: Node | undefined): string =>
  node === undefined ? "" : (node.value ?? node.children?.map(textOf).join("") ?? "");

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
    <code className="rounded-sm bg-muted px-1 py-0.5 text-[0.9em]" {...props} />
  ),
  pre: ({ node }) => {
    const code = node?.children.find((child) => child.type === "element");
    const language = code?.properties.className;
    const written = Array.isArray(language)
      ? language.find((name) => String(name).startsWith("language-"))
      : undefined;
    return (
      <CodeBlock
        language={written === undefined ? undefined : String(written).slice("language-".length)}
        code={textOf(code).replace(/\n$/, "")}
      />
    );
  },
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

type MathsPlugins = typeof import("./maths-plugins.ts");

/** Drawing formulas, once it has loaded, so later blocks draw theirs at once. */
let mathsPlugins: MathsPlugins | undefined;

/** Drawing formulas, loaded the first time a block has maths in it. */
const useMathsPlugins = (needed: boolean) => {
  const [loaded, setLoaded] = useState(mathsPlugins);
  useEffect(() => {
    if (!needed || loaded) return;
    let current = true;
    void import("./maths-plugins.ts")
      .then((plugins) => {
        mathsPlugins = plugins;
        if (current) setLoaded(plugins);
      })
      // The formulas stay as the model wrote them, which still reads.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [needed, loaded]);
  return needed ? loaded : undefined;
};

/**
 * One block of an answer, memoised on its text, so finished blocks aren't formatted again. A
 * block with maths in it is drawn with formulas once they've loaded.
 */
const Block = memo(function Block(props: { text: string }) {
  const maths = useMathsPlugins(hasMaths(props.text));
  if (maths === undefined) {
    return (
      <Markdown remarkPlugins={PLUGINS} components={ELEMENTS}>
        {props.text}
      </Markdown>
    );
  }
  return (
    <Markdown
      remarkPlugins={[...PLUGINS, ...maths.remarkPlugins]}
      rehypePlugins={maths.rehypePlugins}
      components={ELEMENTS}
    >
      {writeMathsForRemark(props.text)}
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
    // Spaced by gaps, not margins, so a formula (whose margins come from KaTeX) spaces like the rest.
    <div className="flex flex-col gap-4 text-base/[26px] wrap-anywhere">
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
