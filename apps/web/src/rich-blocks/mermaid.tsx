import mermaid from "mermaid";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { cleanDiagram } from "./diagram-svg.ts";
import type { DrawingProps } from "./fenced.tsx";
import { RichBlock } from "./rich-block.tsx";

const DARK = "(prefers-color-scheme: dark)";

const watchDark = (changed: () => void) => {
  const query = window.matchMedia(DARK);
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
};

/** Whether the device is in dark mode, so a diagram is drawn again in the other colours. */
const useDark = () => useSyncExternalStore(watchDark, () => window.matchMedia(DARK).matches);

/** A Moorland colour by its name in styles.css, as Mermaid needs it: a value, not a variable. */
const colour = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();

/**
 * Mermaid's settings: strict, its labels drawn as text and never as HTML, laid out by dagre (ELK
 * isn't even built: vite.config.ts), and Moorland's colours and font. Every setting is in
 * `secure`, so nothing a diagram says (`%%{init}%%`, front matter) can change any of them.
 */
const configure = (dark: boolean) => {
  const muted = colour("muted-foreground");
  const font = getComputedStyle(document.body).fontFamily;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    layout: "dagre",
    suppressErrorRendering: true,
    // Flat, as the rest of Moorland is: no shadows or gradients. A little closer together than
    // Mermaid's own spacing, so a three-way choice fits an answer's width.
    look: "classic",
    flowchart: { nodeSpacing: 30, rankSpacing: 40 },
    theme: "base",
    darkMode: dark,
    fontFamily: font,
    fontSize: 14,
    themeVariables: {
      darkMode: dark,
      fontFamily: font,
      fontSize: "14px",
      background: colour("field"),
      primaryColor: colour("accent"),
      primaryBorderColor: colour("primary"),
      primaryTextColor: colour("foreground"),
      secondaryColor: colour("card"),
      tertiaryColor: colour("background"),
      textColor: colour("foreground"),
      lineColor: muted,
      edgeLabelBackground: colour("field"),
      clusterBkg: colour("background"),
      clusterBorder: colour("border"),
      noteBkgColor: colour("background"),
      noteBorderColor: colour("border"),
      noteTextColor: colour("foreground"),
    },
    // Steps outlined in heather on a pale fill, quiet grey arrows with semibold labels.
    themeCSS: [
      ".node rect, .node polygon, .node circle, .node path { stroke-width: 1.5px; }",
      ".node rect { rx: 8px; ry: 8px; }",
      ".nodeLabel, .node text { font-weight: 500; }",
      `.edgeLabel text, .edgeLabel tspan { fill: ${muted}; font-size: 12px; font-weight: 600; }`,
      // An arrow's label hides the line behind it.
      ".edgeLabel rect { opacity: 1; }",
    ].join("\n"),
    secure: [...Object.keys(mermaid.mermaidAPI.defaultConfig), "htmlLabels", "layout"],
  });
};

/** The last diagram asked for, so diagrams draw one at a time: Mermaid's settings are shared. */
let queue: Promise<unknown> = Promise.resolve();

/** A diagram drawn from its source, cleaned, ready to show; `undefined` when it can't be drawn. */
const draw = (options: { id: string; source: string; dark: boolean }) => {
  const drawing = queue.then(async () => {
    try {
      configure(options.dark);
      const { svg } = await mermaid.render(options.id, options.source);
      return cleanDiagram(svg, options.id);
    } catch {
      // Mermaid can't read the source, or can't draw what it read.
      return undefined;
    }
  });
  queue = drawing;
  return drawing;
};

/**
 * A `mermaid` block drawn as a diagram (ADR 0021), once it has all arrived: Mermaid costs too
 * much to run on every streamed word. Drawn again in the other colours when the device changes
 * between light and dark. A wide one scrolls sideways inside the answer.
 */
export default function Diagram({ source, arriving, fallback }: DrawingProps) {
  const id = `diagram-${useId().replace(/[^\w-]/g, "")}`;
  const dark = useDark();
  const holder = useRef<HTMLDivElement>(null);
  const asked = `${dark}\n${source}`;
  const [failed, setFailed] = useState<string>();
  const [drawn, setDrawn] = useState<string>();

  useEffect(() => {
    if (arriving) return;
    let current = true;
    void draw({ id, source, dark }).then((svg) => {
      if (!current) return;
      if (svg === undefined) {
        setFailed(asked);
        return;
      }
      holder.current?.replaceChildren(svg);
      setDrawn(asked);
    });
    return () => {
      current = false;
    };
  }, [id, source, dark, arriving, asked]);

  if (arriving || failed === asked) return fallback;
  return (
    <RichBlock>
      <figure
        aria-label="Diagram"
        aria-busy={drawn !== asked}
        className="overflow-x-auto rounded-md border bg-field px-5 py-6"
      >
        <div ref={holder} className="mx-auto w-fit" />
      </figure>
    </RichBlock>
  );
}
