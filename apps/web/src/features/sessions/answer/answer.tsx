import { textOf } from "@courtyard/ui/answer/hast.ts";
import { MARKDOWN_ELEMENTS, MARKDOWN_PLUGINS } from "@courtyard/ui/answer/markdown.tsx";
import { MarkdownTable } from "@courtyard/ui/answer/table.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { memo, useEffect, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import { Arriving, FencedBlock, fencedKind } from "../../../components/rich-blocks/fenced.tsx";
import { RichBlock } from "../../../components/rich-blocks/rich-block.tsx";
import { finishForNow, splitBlocks } from "./blocks.ts";
import { CodeBlock } from "./code-block.tsx";
import { hasMaths, writeMathsForRemark } from "./maths.ts";
import { useReveal } from "./reveal.ts";

/**
 * How each part of an answer looks: the shared elements (`packages/ui/answer/markdown.tsx`, which
 * Fabrication's chat uses too), with the fences Courtyard draws and each table in a `RichBlock`.
 */
const ELEMENTS: Components = {
  ...MARKDOWN_ELEMENTS,
  pre: ({ node }) => {
    const code = node?.children.find((child) => child.type === "element");
    const names = code?.properties.className;
    const written = Array.isArray(names)
      ? names.find((name) => String(name).startsWith("language-"))
      : undefined;
    const language = written === undefined ? undefined : String(written).slice("language-".length);
    const source = textOf(code).replace(/\n$/, "");
    // A fence Courtyard draws (ADR 0021), when its language is one; otherwise code.
    const kind = fencedKind(language);
    return kind === undefined || language === undefined ? (
      <CodeBlock language={language} code={source} />
    ) : (
      <FencedBlock kind={kind} language={language} source={source} />
    );
  },
  // Its classes are the rich blocks' stylesheet's, which apply only inside a `RichBlock`.
  table: (props) => (
    <RichBlock>
      <MarkdownTable {...props} />
    </RichBlock>
  ),
};

type MathsPlugins = typeof import("./maths-plugins.ts");

/** Drawing formulas, once it has loaded, so later blocks draw theirs at once. */
let mathsPlugins: MathsPlugins | undefined;

/**
 * Drawing formulas, loaded the first time a block has maths in it: `"loading"` until then, and
 * `undefined` when there's no maths, or it couldn't load.
 */
const useMathsPlugins = (needed: boolean): MathsPlugins | "loading" | undefined => {
  const [loaded, setLoaded] = useState(mathsPlugins);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!needed || loaded) return;
    let current = true;
    void import("./maths-plugins.ts")
      .then((plugins) => {
        mathsPlugins = plugins;
        if (current) setLoaded(plugins);
      })
      // The formulas stay as the model wrote them, which still reads.
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [needed, loaded]);
  if (!needed || failed) return undefined;
  return loaded ?? "loading";
};

/**
 * One block of an answer, memoised on its text, so finished blocks aren't formatted again. A
 * block with maths in it is drawn with formulas once they've loaded; until then it keeps its room
 * unseen, never showing them raw (nothing jumps in).
 */
const Block = memo(function Block(props: {
  text: string;
  /** It's the last block of a streaming answer, so it may be half written. */
  arriving: boolean;
}) {
  const maths = useMathsPlugins(hasMaths(props.text));
  const asWritten = (
    <Markdown remarkPlugins={MARKDOWN_PLUGINS} components={ELEMENTS}>
      {props.text}
    </Markdown>
  );
  return (
    <Arriving value={props.arriving}>
      {maths === "loading" ? (
        <div aria-busy className="contents invisible">
          {asWritten}
        </div>
      ) : maths === undefined ? (
        asWritten
      ) : (
        <Markdown
          remarkPlugins={[...MARKDOWN_PLUGINS, ...maths.remarkPlugins]}
          rehypePlugins={maths.rehypePlugins}
          components={ELEMENTS}
        >
          {writeMathsForRemark(props.text)}
        </Markdown>
      )}
    </Arriving>
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
  /** At body size, in a box beside other things (a pull request's description, #240). */
  compact?: boolean;
}) {
  const shown = useReveal(props.text, { running: props.running, replayed: props.replayed });
  const blocks = splitBlocks(shown);
  return (
    // Spaced by gaps, not margins, so a formula (whose margins come from KaTeX) spaces like the rest.
    <div
      className={classes(
        "flex flex-col wrap-anywhere",
        props.compact ? "gap-3 text-body" : "gap-4 text-answer",
      )}
    >
      {blocks.map((block, index) => {
        const arriving = props.running && index === blocks.length - 1;
        return (
          <Block
            // biome-ignore lint/suspicious/noArrayIndexKey: blocks only grow, in order (a definition arriving makes the answer one block, which just draws it again)
            key={index}
            text={arriving ? finishForNow(block) : block}
            arriving={arriving}
          />
        );
      })}
    </div>
  );
});
