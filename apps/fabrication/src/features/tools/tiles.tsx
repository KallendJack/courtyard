import { COMMON_TOOLS, PRINTER_TOOL, THING_FIELD_MAX_CHARACTERS } from "@courtyard/contract";
import { Button, IconButton } from "@courtyard/ui/buttons/button.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { Check, Minus, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ownPicks, type Picks, pickOf, tileName } from "./picks.ts";

/** A tile: the board's 44 high, its tool's name beside a tick when it's ticked. */
const TILE = "flex h-11 min-w-0 items-center gap-1 rounded-row";

/** What the tiles do to the picks. */
export type Ticking = {
  toggle: (name: string) => void;
  recount: (name: string, by: 1 | -1) => void;
  add: (name: string) => void;
  describePrinter: (printer: { brand: string; size: string }) => void;
};

/** One tool to tick: its name, and on a ticked one, one more or one fewer. */
function Tile(props: { name: string; picks: Picks; ticking: Ticking }) {
  const pick = pickOf(props.picks, props.name);
  const ticked = pick !== undefined;
  return (
    <li
      className={classes(
        TILE,
        "pr-1",
        ticked ? "border border-primary bg-primary/15" : "border border-transparent bg-secondary",
      )}
    >
      <button
        type="button"
        aria-pressed={ticked}
        onClick={() => props.ticking.toggle(props.name)}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-row pl-3 text-left text-interface text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span aria-hidden className="w-3.5 shrink-0 text-success">
          {ticked && <Check className="size-3.5" />}
        </span>
        <span className={classes("truncate", ticked && "font-semibold")}>
          {pick === undefined ? props.name : tileName(pick)}
        </span>
      </button>
      {ticked && (pick.count ?? 1) > 1 && (
        <IconButton
          size="sm"
          label={`One fewer ${props.name}`}
          icon={<Minus />}
          onClick={() => props.ticking.recount(props.name, -1)}
        />
      )}
      {ticked && (
        <IconButton
          size="sm"
          label={`One more ${props.name}`}
          icon={<Plus />}
          onClick={() => props.ticking.recount(props.name, 1)}
        />
      )}
    </li>
  );
}

/** A group's tiles, four to a row, two on the cover screen. */
function Group(props: { name: string; children: ReactNode }) {
  const id = `group-${props.name.toLowerCase().replaceAll(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <CapsLabel tone="muted" heading={{ level: 2, id }}>
        {props.name}
      </CapsLabel>
      <ul className="grid grid-cols-2 gap-2 md:grid-cols-4">{props.children}</ul>
    </section>
  );
}

/** "Add your own": a tile that opens into a name to add, ticked once added. */
function AddYourOwn(props: { add: (name: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  if (!adding) {
    return (
      <li className="flex">
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={classes(
            TILE,
            "w-full border border-dashed border-input px-3 text-interface font-semibold text-primary-text outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          )}
        >
          <Plus aria-hidden className="size-3.5 shrink-0" />
          Add your own
        </button>
      </li>
    );
  }
  return (
    <li className="col-span-2">
      <form
        className={classes(TILE, "border border-dashed border-input pr-1 pl-3")}
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() === "") return;
          props.add(name);
          setName("");
          setAdding(false);
        }}
      >
        <label className="sr-only" htmlFor="own-tool">
          Your own tool
        </label>
        <input
          id="own-tool"
          // Opened by a tap on Add your own, so the keyboard is what the owner asked for.
          // biome-ignore lint/a11y/noAutofocus: the owner just asked to type a tool's name.
          autoFocus
          value={name}
          maxLength={THING_FIELD_MAX_CHARACTERS}
          onChange={(event) => setName(event.target.value)}
          placeholder="Router, band saw…"
          className="min-w-0 flex-1 bg-transparent text-interface text-foreground outline-none placeholder:text-muted-foreground"
        />
        <Button type="submit" variant="soft" size="sm" disabled={name.trim() === ""}>
          Add
        </Button>
      </form>
    </li>
  );
}

/** Which 3D printer, asked once it's ticked, so printed parts fit its plate (#702). */
function WhichPrinter(props: { picks: Picks; ticking: Ticking }) {
  const printer = pickOf(props.picks, PRINTER_TOOL);
  if (printer === undefined) return null;
  const field = (what: "brand" | "size", label: string, example: string) => (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-meta text-muted-foreground">
      {label}
      <input
        value={printer[what] ?? ""}
        maxLength={THING_FIELD_MAX_CHARACTERS}
        onChange={(event) =>
          props.ticking.describePrinter({
            brand: printer.brand ?? "",
            size: printer.size ?? "",
            [what]: event.target.value,
          })
        }
        placeholder={example}
        className="h-10 rounded-md border border-input bg-field px-2.5 text-interface text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      />
    </label>
  );
  return (
    <fieldset className="flex flex-col gap-2 rounded-row bg-secondary p-3">
      <legend className="sr-only">Which 3D printer?</legend>
      <p aria-hidden className="text-interface font-semibold text-foreground">
        Which 3D printer?
      </p>
      <div className="flex flex-col gap-2 md:flex-row">
        {field("brand", "Make and model", "Bambu Lab P1S")}
        {field("size", "Plate size", "256 × 256 × 256 mm")}
      </div>
    </fieldset>
  );
}

/**
 * The common tools in their four groups (#707; Paper, 2 · Agreed, "Fabrication · Your tools,
 * first open"), each a tile to tick; the owner's own after the last group's, then Add your own.
 */
export function ToolTiles(props: { picks: Picks; ticking: Ticking }) {
  const own = ownPicks(props.picks);
  return (
    <div className="flex flex-col gap-3.5">
      {COMMON_TOOLS.map(({ group, tools }, index) => (
        <Group key={group} name={group}>
          {tools.map((tool) => (
            <Tile key={tool} name={tool} picks={props.picks} ticking={props.ticking} />
          ))}
          {index === COMMON_TOOLS.length - 1 && (
            <>
              {own.map((pick) => (
                <Tile
                  key={pick.name}
                  name={pick.name}
                  picks={props.picks}
                  ticking={props.ticking}
                />
              ))}
              <AddYourOwn add={props.ticking.add} />
            </>
          )}
        </Group>
      ))}
      <WhichPrinter picks={props.picks} ticking={props.ticking} />
    </div>
  );
}
