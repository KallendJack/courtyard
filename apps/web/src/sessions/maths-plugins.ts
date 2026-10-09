import "katex/dist/katex.min.css";
import "./maths.css";
import type { Options } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

type PluggableList = NonNullable<Options["remarkPlugins"]>;

/**
 * Drawing formulas, loaded only when an answer has maths in it and never on the first load.
 * remark-math reads `$$…$$` and never a single `$`, so prices stay text; KaTeX draws each formula
 * as elements, with MathML for screen readers.
 */
export const remarkPlugins: PluggableList = [[remarkMath, { singleDollarTextMath: false }]];
export const rehypePlugins: PluggableList = [rehypeKatex];
