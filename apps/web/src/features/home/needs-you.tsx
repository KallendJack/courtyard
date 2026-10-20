import type { NeedYou } from "@courtyard/contract";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Block, BlockEmpty, BlockRows } from "@/components/layout/home-block";
import { PlaceholderRows } from "@/components/layout/kept";
import { Allow, Retry } from "../builders/builder-actions.tsx";
import { builderName } from "../builders/words.ts";
import { needLink, needTitle, needWords, useNeedsYou } from "../waiting/api.ts";
import "./stylesheet.ts";

/** A row's key: what it is, and whose. */
const keyOf = (need: NeedYou) =>
  `${need.kind}-${need.session.id}${"pullRequest" in need ? `-${need.pullRequest.number}` : ""}`;

/**
 * A Lead's builder's action that acts in place (#592; Paper, "Tablet · Home: builders in Needs
 * you"): Allow on its approval, Retry when it's Stuck, in the row's first column.
 */
const actsInPlace = (need: NeedYou, onChanged: () => void) => {
  if (need.builder !== true || "pullRequest" in need) return undefined;
  if (need.approval !== undefined) {
    return (
      <Allow
        sessionId={need.session.id}
        approval={need.approval.number}
        label={needTitle(need)}
        look="words"
        onChanged={onChanged}
      />
    );
  }
  return need.kind === "stuck" ? (
    <Retry
      sessionId={need.session.id}
      name={builderName(need.session.title)}
      look="words"
      onChanged={onChanged}
    />
  ) : undefined;
};

/**
 * One thing waiting, as a row that opens it in one tap (#492; Paper, "Home, Needs you"): what to
 * do in gold, what it is, and its workspace; on the cover screen, what to do and the workspace
 * above what it is. A Lead's builder's Allow and Retry act right there (#592), the rest of its
 * row still opening it.
 */
function NeedRow(props: { need: NeedYou; onChanged: () => void }) {
  const { need } = props;
  const words = needWords(need);
  const title = needTitle(need);
  const acts = actsInPlace(need, props.onChanged);
  return (
    <li className="flex min-h-12 items-center gap-3 rounded-row px-1.5 hover:bg-muted/60">
      {acts !== undefined && (
        <span className="flex w-24 shrink-0 flex-col items-start md:w-28">{acts}</span>
      )}
      <Link
        {...needLink(need)}
        aria-label={`${words} · ${title} · ${need.workspace.name}`}
        className="flex min-h-12 min-w-0 flex-1 items-center gap-3 py-1.5"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 md:flex-row md:items-center md:gap-3">
          {acts === undefined ? (
            <span className="truncate text-meta font-semibold text-warning md:w-28 md:shrink-0">
              {words}
              <span className="md:hidden"> · {need.workspace.name}</span>
            </span>
          ) : (
            <span className="truncate text-meta font-semibold text-muted-foreground md:hidden">
              {need.workspace.name}
            </span>
          )}
          <span className="truncate text-sm/4.5 font-bold md:flex-1">{title}</span>
          <span className="hidden max-w-40 shrink-0 truncate text-meta font-medium text-muted-foreground md:block">
            {need.workspace.name}
          </span>
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

/**
 * Home's Needs you (#492): everything waiting on the owner in every workspace, as the worker says
 * (`waiting/`), one row each, at the top of Home. It keeps the size its slot gives it: more rows
 * than fit scroll inside it, none says so in one quiet line, and faint rows hold its place the
 * first time.
 */
export default function HomeNeedsYou() {
  // Asked again once a row has acted in place (#592).
  const [again, setAgain] = useState(0);
  const known = useNeedsYou(again);
  if (known === undefined) {
    return (
      <Block label="Needs you" fillsSlot>
        <PlaceholderRows count={2} size="line" />
      </Block>
    );
  }
  const { needs } = known;
  if (needs.length === 0) {
    return (
      <Block label="Needs you" fillsSlot>
        <BlockEmpty>Nothing needs you</BlockEmpty>
      </Block>
    );
  }
  return (
    <Block label="Needs you" count={needs.length} needs fillsSlot>
      <BlockRows>
        <ul className="flex flex-col">
          {needs.map((need) => (
            <NeedRow key={keyOf(need)} need={need} onChanged={() => setAgain((was) => was + 1)} />
          ))}
        </ul>
      </BlockRows>
    </Block>
  );
}
