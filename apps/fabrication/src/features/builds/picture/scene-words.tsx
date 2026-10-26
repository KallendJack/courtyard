import { classes } from "@courtyard/ui/lib/classes.ts";
import { type BuildScene, letteredOf, markClass, markWords } from "../scene.ts";

// The words over the Build in 3D (#754): the scene's marks, the callouts' leaders and each part
// lit at the step, a letter on a computer or a pill off the wood with its leader at the bench
// (#826). Each is placed by the 3D view (`bench-view.tsx`) through `place` and `lead`, as the
// model turns.

export function SceneWords(props: {
  scene: BuildScene;
  lit: string | undefined;
  pick: (label: string) => void;
  bench: boolean;
  /** Where each word is, for the view to move it. */
  place: (key: string) => (element: HTMLElement | null) => void;
  /** Each pill's leader, for the view to draw it. */
  lead: (key: string) => (line: SVGLineElement | null) => void;
}) {
  const { scene, lit, bench, place, lead } = props;
  const lettered = letteredOf(scene);
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
          ) : null,
        )}
        {bench &&
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
            bench
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
          {bench ? `${part.name} (${part.label})` : part.label}
        </button>
      ))}
    </>
  );
}
