import {
  OptionsBlock as Options,
  optionsPart,
  type ProjectSlug,
  SessionDetail,
  type ThingUpcoming,
  WorkspaceId,
} from "@courtyard/contract";
import { useParams } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { fromWorker } from "@/api/worker";
import { Button } from "@/components/buttons/button";
import { WebLink } from "@/components/buttons/web-link";
import { FormError } from "@/components/forms/form-error";
import { createKept, useKept } from "@/components/layout/kept";
import { useAction } from "@/hooks/use-action";
import { classes } from "@/lib/classes";
import { KEPT_HOME, loadKeptHome } from "../../features/planning-home/api.ts";
import { pickDecision } from "../../features/projects/api.ts";
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

/** Each session's project as last heard (#603), by its id: `null` for none. */
const KEPT_SESSION_PROJECT = createKept<{ project: ProjectSlug | null }>();

/** A decision's option as its project's file keeps it: one line, with no `;` between options. */
const decisionOption = (name: string) => name.replaceAll(";", ",");

/**
 * An `options` block (#602, #603; Paper, "Tablet · Find a replacement: budget tapped, options with
 * Pick (#602)"): real options side by side (stacked on a phone), the model's pick first, in
 * violet. Each has its name, its price and its shop linking to its page, a line why, and Pick,
 * with no model turn. For one of the owner's Things, Pick makes it the Thing's upcoming one, and
 * the one picked shows ✓ Upcoming. For a decision, in a session that belongs to a project, Pick
 * records the project's decision (the options, the pick and why), and the one picked shows
 * ✓ Decided: the same Pick, nothing new to see. With nothing to pick for (the Thing gone, or no
 * project), the options show without Pick. JSON that isn't options shows the fallback.
 */
export default function OptionsCards(props: DrawingProps) {
  const block = useMemo(() => optionsFrom(props.source), [props.source]);
  const params = useParams({ strict: false });
  const named = WorkspaceId.safeParse(params.workspaceId);
  const workspaceId = named.success ? named.data : undefined;
  const sessionId = params.sessionId;
  const slug = block?.part === undefined ? undefined : optionsPart(block.part);
  const things = useKept(KEPT_THINGS, {
    key: workspaceId ?? "",
    asking: workspaceId !== undefined && slug !== undefined,
    load: async () => {
      if (workspaceId === undefined) return undefined;
      const loaded = await loadThings(workspaceId);
      return loaded.kind === "loaded" ? loaded.data : undefined;
    },
  });
  const deciding = block?.about !== undefined && sessionId !== undefined;
  const belongs = useKept(KEPT_SESSION_PROJECT, {
    key: sessionId ?? "",
    asking: deciding,
    load: async () => {
      if (sessionId === undefined) return undefined;
      const loaded = await fromWorker(`/sessions/${encodeURIComponent(sessionId)}`, SessionDetail);
      return loaded.kind === "loaded" ? { project: loaded.data.project ?? null } : undefined;
    },
  });
  const projectSlug = belongs?.project ?? undefined;
  const home = useKept(KEPT_HOME, {
    key: workspaceId ?? "",
    asking: workspaceId !== undefined && projectSlug !== undefined,
    load: () =>
      workspaceId === undefined ? Promise.resolve(undefined) : loadKeptHome(workspaceId),
  });
  const part = things?.things.find((thing) => thing.slug === slug);
  const project = home?.projects.find((one) => one.slug === projectSlug);
  /** The option being picked, so only its Pick shows it's working. */
  const [picking, setPicking] = useState<string>();
  const pick = useAction(async (option: ThingUpcoming) => {
    if (workspaceId === undefined || block === undefined) return undefined;
    if (slug !== undefined && part !== undefined) {
      const picked = await pickUpcoming(workspaceId, slug, option);
      if (picked.kind !== "loaded") return describeProblem(picked).body;
      await loadKeptThings(workspaceId);
    }
    if (block.about !== undefined && project !== undefined) {
      const decided = await pickDecision(workspaceId, project.slug, {
        about: block.about,
        options: block.options.map(({ name }) => decisionOption(name)),
        pick: option.name,
        ...(option.why === undefined ? {} : { why: option.why }),
      });
      if (decided.kind !== "loaded") return describeProblem(decided).body;
      await loadKeptHome(workspaceId);
    }
    return undefined;
  });
  if (block === undefined) return props.fallback;
  const decision =
    block.about === undefined
      ? undefined
      : project?.decisions.find(({ about }) => sameName(about, block.about ?? ""));
  /** The option picked already: the part's upcoming one, else the project's decision. */
  const picked = part === undefined ? decision?.pick : part.upcoming?.name;
  const canPick = part !== undefined || (block.about !== undefined && project !== undefined);

  return (
    <RichBlock>
      <div className="flex flex-col gap-2">
        <ul
          aria-label={
            part !== undefined
              ? `Options for ${part.name}`
              : block.about !== undefined
                ? `Options for ${block.about}`
                : "Options"
          }
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
                {(option.price !== undefined || option.link !== undefined) && (
                  <span
                    className={classes(
                      "text-meta font-semibold",
                      first ? "text-primary-text" : "text-foreground/75",
                    )}
                  >
                    {option.link === undefined
                      ? option.price
                      : option.price === undefined
                        ? null
                        : `${option.price} · `}
                    {option.link !== undefined && (
                      <WebLink href={option.link}>{`${option.shop ?? "Shop"} ›`}</WebLink>
                    )}
                  </span>
                )}
                {option.why !== undefined && (
                  <span className="grow text-meta font-medium text-foreground/75">
                    {option.why}
                  </span>
                )}
                {!canPick ? null : picked !== undefined && sameName(picked, option.name) ? (
                  <span className="mt-auto flex h-9 items-center justify-center gap-1.5 text-meta font-semibold text-foreground/80">
                    <Check aria-hidden className="size-3.5" />
                    {part === undefined ? "Decided" : "Upcoming"}
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
