import {
  Component,
  type ComponentType,
  createContext,
  type ReactNode,
  use,
  useEffect,
  useState,
} from "react";
import { CodeBlock } from "../sessions/code-block.tsx";

/** What a fenced block's drawing is given. */
export type DrawingProps = {
  /** The fence's text, as the model wrote it, or as much of it as has arrived. */
  readonly source: string;
  /**
   * Whether the block is still arriving: the answer is streaming and this is its last block, so
   * the source may be half written. A costly drawing can wait for the rest.
   */
  readonly arriving: boolean;
  /**
   * What to show instead when the source can't be drawn: the source under "Couldn't draw this
   * <noun>", or just the source while it's still arriving. Never a drawing's own error.
   */
  readonly fallback: ReactNode;
};

/** A drawing module: its default export draws a block's source, or shows the fallback. */
type Drawing = { readonly default: ComponentType<DrawingProps> };

/** A kind of fenced block Courtyard draws itself (ADR 0021). */
type FencedKind = {
  /** What the block is called to the owner: "Couldn't draw this <noun>". */
  readonly noun: string;
  /** Its drawing, loaded the first time an answer or a document has one, never on the first load. */
  readonly load: () => Promise<Drawing>;
};

/**
 * The fenced blocks Courtyard draws, by the language written after the fence. A new kind is one
 * entry here and a module whose default export takes `DrawingProps`, in this folder, plus its
 * rule in docs/ai-conduct.md; a block of any other language is code.
 */
const FENCED_KINDS = new Map<string, FencedKind>([
  ["chart", { noun: "chart", load: () => import("./chart.tsx") }],
]);

/** The kind of block a fence is, by its language, when it's one Courtyard draws. */
export const fencedKind = (language: string | undefined) =>
  language === undefined ? undefined : FENCED_KINDS.get(language.toLowerCase());

/** Whether the block being drawn is the last of a streaming answer, so it may still be arriving. */
export const Arriving = createContext(false);

/** The drawings loaded so far, so later blocks draw at once. */
const loaded = new Map<FencedKind, Drawing>();

type Loading =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly drawing: Drawing }
  | { readonly kind: "failed" };

/** A kind's drawing, loaded the first time a block needs it. */
const useDrawing = (kind: FencedKind): Loading => {
  const [state, setState] = useState<Loading>(() => {
    const drawing = loaded.get(kind);
    return drawing === undefined ? { kind: "loading" } : { kind: "loaded", drawing };
  });
  useEffect(() => {
    if (state.kind !== "loading") return;
    let current = true;
    kind
      .load()
      .then((drawing) => {
        loaded.set(kind, drawing);
        if (current) setState({ kind: "loaded", drawing });
      })
      // Offline, say: the block shows what the model wrote, which still reads.
      .catch(() => current && setState({ kind: "failed" }));
    return () => {
      current = false;
    };
  }, [kind, state.kind]);
  return state;
};

/**
 * Shows the fallback in place of a drawing that broke while drawing, so the answer still reads,
 * and tries again once more of the source has arrived.
 */
class Unbroken extends Component<
  { source: string; fallback: ReactNode; children: ReactNode },
  { broke: boolean; source: string }
> {
  override state = { broke: false, source: this.props.source };
  static getDerivedStateFromError() {
    return { broke: true };
  }
  static getDerivedStateFromProps(props: { source: string }, state: { source: string }) {
    return props.source === state.source ? null : { broke: false, source: props.source };
  }
  override render() {
    return this.state.broke ? this.props.fallback : this.props.children;
  }
}

/**
 * A fenced block Courtyard draws (a chart, a diagram), the one place fences become rich blocks.
 * Until its drawing has loaded, and whenever it can't be drawn while it's still arriving, it shows
 * the source as code; one that can't be drawn once it's all there shows the source under a line
 * saying so. The rest of the answer reads as normal either way.
 */
export function FencedBlock(props: { kind: FencedKind; language: string; source: string }) {
  const arriving = use(Arriving);
  const drawing = useDrawing(props.kind);
  const asCode = <CodeBlock language={props.language} code={props.source} />;
  const fallback = arriving ? (
    asCode
  ) : (
    <CodeBlock
      language={props.language}
      code={props.source}
      problem={`Couldn't draw this ${props.kind.noun}, so here's what the model wrote`}
    />
  );
  if (drawing.kind === "loading") return asCode;
  if (drawing.kind === "failed") return fallback;
  const Draw = drawing.drawing.default;
  return (
    <Unbroken source={props.source} fallback={fallback}>
      <Draw source={props.source} arriving={arriving} fallback={fallback} />
    </Unbroken>
  );
}
