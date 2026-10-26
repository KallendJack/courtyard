import { classes } from "@courtyard/ui/lib/classes.ts";
import { type BuildScene, letteredOf, markClass, markWords } from "../scene.ts";

// The words over the Build in 3D (#754): the scene's marks, the callouts' leaders, a size's gold
// dimension line (#826) and each part lit at the step, a letter, or a pill off the wood with its
// leader at the bench with the Fold open (#826). Each is placed by the 3D view (`bench-view.tsx`)
// through `place` and `lead`, as the model turns.

/**
 * How the parts lit at the step are named: a letter on each, a pill off the wood with its leader
 * (the end frames' board), or not at all where the picture's callouts say what's what (the
 * castors' board).
 */
export type PartWords = "letters" | "pills" | "none";

export function SceneWords(props: {
  scene: BuildScene;
  lit: string | undefined;
  pick: (label: string) => void;
  parts: PartWords;
  /** Where each word is, for the view to move it. */
  place: (key: string) => (element: HTMLElement | null) => void;
  /** Each leader and dimension line, for the view to draw it. */
  lead: (key: string) => (line: SVGLineElement | null) => void;
}) {
  const { scene, lit, parts, place, lead } = props;
  const lettered = parts === "none" ? [] : letteredOf(scene);
  return (
    <>
      <svg aria-hidden className="pointer-events-none absolute inset-0 size-full">
        {scene.marks.map((mark, at) =>
          mark.kind === "callout" ? (
            <line
              // biome-ignore lint/suspicious/noArrayIndexKey: a scene's marks are in a fixed order.
              key={at}
              ref={lead(`mark ${at}`)}
              strokeWidth={1.5}
              className={mark.tone === "yours" ? "stroke-yours" : "stroke-success"}
            />
          ) : mark.kind === "size" ? (
            // The size's line as the boards draw it: bold, its ends carried to what it measures.
            // biome-ignore lint/suspicious/noArrayIndexKey: a scene's marks are in a fixed order.
            <g key={at} className="stroke-warning">
              <line ref={lead(`mark ${at}`)} strokeWidth={2.5} strokeLinecap="round" />
              <line ref={lead(`mark ${at} from`)} strokeWidth={1.2} strokeDasharray="3 2" />
              <line ref={lead(`mark ${at} to`)} strokeWidth={1.2} strokeDasharray="3 2" />
            </g>
          ) : null,
        )}
        {parts === "pills" &&
          lettered.map((part) => (
            <line
              key={part.label}
              ref={lead(`part ${part.label}`)}
              strokeWidth={1.5}
              className="stroke-foreground/70"
            />
          ))}
      </svg>
      {scene.marks.map((mark, at) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: a scene's marks are in a fixed order.
          key={at}
          ref={place(`mark ${at}`)}
          className={classes(
            "pointer-events-none absolute top-0 left-0 whitespace-nowrap",
            mark.kind !== "badge" && mark.kind !== "spot" && "rounded-sm px-1",
            markClass(mark),
          )}
        >
          {mark.kind === "callout" ? (
            <>
              <span className="block font-semibold">{mark.says}</span>
              {mark.more !== undefined && (
                <span className="block group-data-small:hidden">{mark.more}</span>
              )}
            </>
          ) : (
            markWords(mark)
          )}
        </span>
      ))}
      {lettered.map((part) => (
        <button
          key={part.label}
          ref={place(`part ${part.label}`)}
          type="button"
          aria-label={`${part.label}, ${part.name}`}
          aria-pressed={lit === part.label}
          aria-current={part.lit ? "step" : undefined}
          onClick={() => props.pick(part.label)}
          className={classes(
            "absolute top-0 left-0 flex items-center justify-center font-bold",
            parts === "pills"
              ? classes(
                  "h-8 rounded-full border px-3.5 text-meta whitespace-nowrap",
                  lit === part.label
                    ? "border-primary bg-primary/25 text-foreground"
                    : "border-input bg-secondary text-foreground",
                )
              : classes(
                  "size-8 rounded-full border-2 font-mono text-meta",
                  lit === part.label || part.lit
                    ? "border-primary-text bg-primary text-primary-foreground"
                    : "border-primary bg-background text-foreground",
                ),
          )}
        >
          {parts === "pills" ? `${part.name} (${part.label})` : part.label}
        </button>
      ))}
    </>
  );
}
