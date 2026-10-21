import {
  OptionsBlock as Options,
  optionsPart,
  type ThingUpcoming,
  WorkspaceId,
} from "@courtyard/contract";
import { useParams } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/buttons/button";
import { WebLink } from "@/components/buttons/web-link";
import { FormError } from "@/components/forms/form-error";
import { useKept } from "@/components/layout/kept";
import { useAction } from "@/hooks/use-action";
import { classes } from "@/lib/classes";
import {
  KEPT_THINGS,
  loadKeptThings,
  loadThings,
  pickUpcoming,
} from "../../features/things/api.ts";
import { describeProblem } from "../layout/problems.tsx";
import type { DrawingProps } from "./fenced.tsx";
import { RichBlock } from "./rich-block.tsx";

/** The block's JSON, when it's options Courtyard can draw. */
const optionsFrom = (source: string) => {
  try {
    const parsed = Options.safeParse(JSON.parse(source));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

const sameName = (a: string, b: string) =>
  a.trim().localeCompare(b.trim(), "en-GB", { sensitivity: "base" }) === 0;

/**
 * An `options` block (#602; Paper, "Tablet · Find a replacement: budget tapped, options with Pick
 * (#602)"): real options for replacing one of the owner's Things, side by side (stacked on a
 * phone), the model's pick first, in violet. Each has its name, its price and its shop linking to
 * its page, a line why, and Pick, which makes it the Thing's upcoming one with no model turn; the
 * one picked shows ✓ Upcoming. With the Thing gone, the options show without Pick. JSON that isn't
 * options shows the fallback.
 */
export default function OptionsCards(props: DrawingProps) {
  const block = useMemo(() => optionsFrom(props.source), [props.source]);
  const params = useParams({ strict: false });
  const named = WorkspaceId.safeParse(params.workspaceId);
  const workspaceId = named.success ? named.data : undefined;
  const slug = block === undefined ? undefined : optionsPart(block.part);
  const things = useKept(KEPT_THINGS, {
    key: workspaceId ?? "",
    asking: workspaceId !== undefined && block !== undefined,
    load: async () => {
      if (workspaceId === undefined) return undefined;
      const loaded = await loadThings(workspaceId);
      return loaded.kind === "loaded" ? loaded.data : undefined;
    },
  });
  /** The option being picked, so only its Pick shows it's working. */
  const [picking, setPicking] = useState<string>();
  const pick = useAction(async (option: ThingUpcoming) => {
    if (workspaceId === undefined || slug === undefined) return undefined;
    const picked = await pickUpcoming(workspaceId, slug, option);
    if (picked.kind !== "loaded") return describeProblem(picked).body;
    await loadKeptThings(workspaceId);
    return undefined;
  });
  if (block === undefined) return props.fallback;
  const part = things?.things.find((thing) => thing.slug === slug);
  const upcoming = part?.upcoming?.name;

  return (
    <RichBlock>
      <div className="flex flex-col gap-2">
        <ul
          aria-label={part === undefined ? "Options" : `Options for ${part.name}`}
          className="flex flex-col gap-2.5 md:flex-row"
        >
          {block.options.map((option, index) => {
            const first = index === 0;
            return (
              <li
                key={option.name}
                aria-label={option.name}
                className={classes(
                  "flex min-w-0 flex-1 basis-0 flex-col gap-1.5 rounded-lg border p-3",
                  first ? "border-primary/35 bg-primary/12" : "bg-surface",
                )}
              >
                <span className="text-interface/5 font-bold text-foreground">{option.name}</span>
                <span
                  className={classes(
                    "text-meta font-semibold",
                    first ? "text-primary-text" : "text-foreground/75",
                  )}
                >
                  {option.price === undefined ? null : `${option.price} · `}
                  <WebLink href={option.link}>{`${option.shop ?? "Shop"} ›`}</WebLink>
                </span>
                {option.why !== undefined && (
                  <span className="grow text-meta font-medium text-foreground/75">
                    {option.why}
                  </span>
                )}
                {part === undefined ? null : upcoming !== undefined &&
                  sameName(upcoming, option.name) ? (
                  <span className="mt-auto flex h-9 items-center justify-center gap-1.5 text-meta font-semibold text-foreground/80">
                    <Check aria-hidden className="size-3.5" />
                    Upcoming
                  </span>
                ) : (
                  <span className="mt-auto flex">
                    <Button
                      variant={first ? "primary" : "outline"}
                      fullWidth
                      busy={pick.busy && picking === option.name}
                      busyLabel="Picking…"
                      waiting={pick.busy && picking !== option.name}
                      onClick={() => {
                        setPicking(option.name);
                        void pick.run(option);
                      }}
                    >
                      Pick
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <FormError message={pick.error} />
      </div>
    </RichBlock>
  );
}
