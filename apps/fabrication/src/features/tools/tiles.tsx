import {
  COMMON_TOOLS,
  PRINTER_TOOL,
  THING_FIELD_MAX_CHARACTERS,
  type ToolPick,
} from "@courtyard/contract";
import { Button, IconButton } from "@courtyard/ui/buttons/button.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { Check, Minus, Plus } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { ownPicks, type Picks, pickOf, tileName } from "./picks.ts";

/** A tile: the board's 44 high, its tool's name beside a tick when it's ticked. */
const TILE = "flex h-11 min-w-0 items-center gap-1 rounded-row";

/** What the tiles do to the picks. */
export type Ticking = {
  toggle: (name: string) => void;
  recount: (name: string, by: 1 | -1) => void;
  add: (name: string) => void;
  /** A ticked tool's make and size, by its name. */
  describe: (name: string, described: { brand: string; size: string }) => void;
  /** The line under a ticked tile: what Save keeps or moves, if it says more than the tile. */
  noteOf: (pick: ToolPick) => string | undefined;
};

/**
 * One tool to tick: its name, and on a ticked one, one more or one fewer, and the line saying what
 * Save keeps or moves ("F-clamps · from Garage"), which describes the tile rather than naming it.
 */
function Tile(props: { name: string; picks: Picks; ticking: Ticking }) {
  const pick = pickOf(props.picks, props.name);
  const ticked = pick !== undefined;
  const note = pick && props.ticking.noteOf(pick);
  const id = useId();
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
        aria-labelledby={`${id}-name`}
        aria-describedby={note === undefined ? undefined : `${id}-note`}
        onClick={() => props.ticking.toggle(props.name)}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-row pl-3 text-left text-interface text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span aria-hidden className="w-3.5 shrink-0 text-success">
          {ticked && <Check className="size-3.5" />}
        </span>
        <span className="flex min-w-0 flex-col">
          <span id={`${id}-name`} className={classes("truncate", ticked && "font-semibold")}>
            {pick === undefined ? props.name : tileName(pick)}
          </span>
          {note !== undefined && (
            <span id={`${id}-note`} className="truncate text-label text-muted-foreground">
              {note}
            </span>
          )}
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

/**
 * The tools asked about once they're ticked, each with its size and an example of it: the 3D
 * printer, so printed parts fit its plate (#702), and the powered saws, so a cut too big for one
 * goes to a saw that takes it (#780).
 */
const ASKED = [
  {
    tool: PRINTER_TOOL,
    brand: "Bambu Lab P1S",
    size: "Plate size",
    example: "256 × 256 × 256 mm",
    from: undefined,
  },
  {
    tool: "Mitre saw",
    brand: "Evolution R210SMS",
    size: "Cuts at 90°, wide × deep",
    example: "120 × 60 mm",
    from: "On its label, or the maker's page.",
  },
  {
    tool: "Circular saw",
    brand: "Makita HS6601",
    size: "Cuts at 90°, deep",
    example: "54 mm",
    from: "On its label, or the maker's page.",
  },
] as const;

/** Which one a ticked tool is, and its size, asked once it's ticked. */
function Which(props: { asked: (typeof ASKED)[number]; picks: Picks; ticking: Ticking }) {
  const { asked } = props;
  const pick = pickOf(props.picks, asked.tool);
  if (pick === undefined) return null;
  const question = `Which ${asked.tool === PRINTER_TOOL ? asked.tool : asked.tool.toLowerCase()}?`;
  const field = (what: "brand" | "size", label: string, example: string) => (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-meta text-muted-foreground">
      {label}
      <input
        value={pick[what] ?? ""}
        maxLength={THING_FIELD_MAX_CHARACTERS}
        onChange={(event) =>
          props.ticking.describe(asked.tool, {
            brand: pick.brand ?? "",
            size: pick.size ?? "",
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
      <legend className="sr-only">{question}</legend>
      <p aria-hidden className="text-interface font-semibold text-foreground">
        {question}
      </p>
      <div className="flex flex-col gap-2 md:flex-row">
        {field("brand", "Make and model", asked.brand)}
        {field("size", asked.size, asked.example)}
      </div>
      {asked.from !== undefined && <p className="text-meta text-muted-foreground">{asked.from}</p>}
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
      {ASKED.map((asked) => (
        <Which key={asked.tool} asked={asked} picks={props.picks} ticking={props.ticking} />
      ))}
    </div>
  );
}
