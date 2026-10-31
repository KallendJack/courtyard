import type { BuildRecipe } from "@courtyard/contract";
import { screwsAlong } from "../bench/close-ups.ts";
import { SCREWS_PER_BRACKET } from "../bench/screws.ts";
import { type BoltLength, type Box, err, ok, type Result } from "../build.ts";
import { boltLength } from "../findings.ts";
import type { Price } from "../stock.ts";
import { alongOf, type Contact, contactOf, extent, thinnest } from "./geometry.ts";
import { type Layout, type Placed, type PlacedFitted, said, stockIn } from "./layout.ts";

// Each joint's fixings (#770), counted where its two pieces really touch: two screws where one
// timber sits on another; screws along each timber a sheet rests on, spaced across the sheet; an
// angle bracket in each corner, two where castors push the joint; bolts through each castor's
// plate, each long enough for all it passes through. A box's panels are screwed along every edge
// where one meets the next.

/** A fixing to buy: how many, at what price, what for, and a bolt's length worked out. */
export type FixingLine = {
  readonly name: string;
  readonly count: number;
  readonly price: Price | undefined;
  readonly for: readonly string[];
  readonly length?: BoltLength;
};

/** Screws where one timber sits on another, on a diagonal. */
const SCREWS_A_JOINT = 2;
/** Brackets in a corner a castor pushes: one lets a bench pushed about work the joint loose. */
const BRACKETS_ROLLING = 2;
/** A box's edge shorter than this (a cleat's end on the back) isn't screwed, mm. */
export const BOX_EDGE = 100;

/** "Castor bases" as one of them: "castor base". */
const one = (name: string) => said(name).replace(/(?<!s)s$/, "");

type Held = { readonly box: Box; readonly piece?: Placed; readonly fitted?: PlacedFitted };

/** The fixings every joint and box needs, by name in the order first used, or why not. */
export const fixingsOf = (options: {
  recipe: BuildRecipe;
  layout: Layout;
  /** What a piece, group or stock is called, by its ID. */
  name: (id: string) => string;
  /** The names of the owner's own things, so bolts they have too short are said (#763). */
  have: readonly string[];
}): Result<FixingLine[], string[]> => {
  const { recipe, layout, name } = options;
  const of = stockIn(recipe);
  const fixing = (id: string) => of(id, "fixing");
  const held = (id: string): Held[] => [
    ...layout.placed
      .filter((piece) => piece.from === id)
      .flatMap((piece) => piece.boxes.map((at) => ({ box: at, piece }))),
    ...layout.fitted
      .filter((fitted) => fitted.from === id)
      .flatMap((fitted) => fitted.boxes.map((at) => ({ box: at, fitted }))),
  ];
  const meeting = (a: string, b: string) =>
    held(a).flatMap((one) =>
      held(b).flatMap((other) => {
        const contact = contactOf(one.box, other.box);
        return contact ? [{ one, other, contact }] : [];
      }),
    );
  const rolling = (id: string) => layout.fitted.some((fitted) => fitted.under === id);

  const lines = new Map<string, FixingLine>();
  const add = (line: Omit<FixingLine, "for"> & { for: string }) => {
    const known = lines.get(line.name);
    lines.set(line.name, {
      ...(known ?? line),
      count: (known?.count ?? 0) + line.count,
      for: [...(known?.for ?? []), ...(known?.for.includes(line.for) ? [] : [line.for])],
    });
  };
  const sheetScrews = recipe.joints.find((joint) => joint.kind === "sheet-screwed")?.fixing;
  const problems: string[] = [];

  recipe.joints.forEach((joint, index) => {
    const [a, b] = joint.joins;
    const purpose = `${said(name(a))} to ${said(name(b))}`;
    const where = `joints.${index}`;
    if (joint.kind === "printed") return;
    if (joint.kind === "sheet-screwed") {
      const sheets = layout.placed.filter((piece) => piece.from === a && piece.kind === "sheet");
      if (sheets.length === 0) {
        problems.push(`${where}: "${a}" isn't cut from a sheet: sheet screws go through a sheet.`);
        return;
      }
      // A line of screws along each timber the sheet's face rests on, and each edge of the sheet
      // pieces it's screwed to (a box's sides and back under a worktop), spread across the sheet.
      // A frame it's screwed to is its rails and the legs they join.
      const frame = recipe.groups.find((group) => group.id === b);
      const onto = new Set([b, ...(frame?.kind === "frame" ? [frame.legs] : [])]);
      let count = 0;
      let meets = false;
      for (const sheet of sheets.flatMap((piece) => piece.boxes)) {
        const across = thinnest(sheet);
        const beneath = layout.placed.filter(
          (piece) => piece.kind === "timber" || (piece.from !== a && onto.has(piece.from)),
        );
        for (const under of beneath) {
          for (const at of under.boxes) {
            const contact = contactOf(sheet, at);
            if (contact?.across !== across) continue;
            // A sheet's face under it (a box's own top) isn't an edge to screw into.
            if (under.kind === "sheet" && thinnest(at) === across) continue;
            const along = alongOf(contact);
            if (contact.face[along] < extent(sheet, along) / 2) continue;
            count += screwsAlong(extent(sheet, along));
            if (onto.has(under.from)) meets = true;
          }
        }
      }
      if (!meets) {
        problems.push(
          `${where}: "${a}" doesn't rest on "${b}": a sheet is screwed to what's under it.`,
        );
        return;
      }
      const screws = fixing(joint.fixing);
      add({ name: screws.name, count, price: screws.price, for: purpose });
      return;
    }

    const contacts = meeting(a, b);
    if (contacts.length === 0) {
      problems.push(`${where}: "${a}" and "${b}" don't meet: a joint holds two pieces that touch.`);
      return;
    }
    if (joint.kind === "screwed") {
      const screws = fixing(joint.fixing);
      add({
        name: screws.name,
        count: SCREWS_A_JOINT * contacts.length,
        price: screws.price,
        for: purpose,
      });
      return;
    }
    if (joint.kind === "bracket") {
      const count = (rolling(a) || rolling(b) ? BRACKETS_ROLLING : 1) * contacts.length;
      const brackets = fixing(joint.fixing);
      const screwsId = joint.screws ?? sheetScrews;
      if (screwsId === undefined) {
        problems.push(`${where}: Say the brackets' screws: there are no sheet screws to use.`);
        return;
      }
      const screws = fixing(screwsId);
      add({ name: brackets.name, count, price: brackets.price, for: purpose });
      add({
        name: screws.name,
        count: count * SCREWS_PER_BRACKET,
        price: screws.price,
        for: purpose,
      });
      return;
    }

    // Bolted: through both pieces where they meet (a castor's plate, not the castor), its washers
    // and nut, and two threads past it.
    const [first] = contacts;
    if (first === undefined) return;
    // A castor that can't sit clear of what stands on its base goes on coach screws from below,
    // nothing through its top (#835): the bolts' thread, at the length that stays in the wood.
    const screws = first.one.fitted?.screws ?? first.other.fitted?.screws;
    if (screws !== undefined) {
      add({
        name: `${joint.bolt.diameter.value} × ${screws} coach screws`,
        count: joint.each * contacts.length,
        price: undefined,
        for: purpose,
      });
      return;
    }
    const thread = `M${joint.bolt.diameter.value}`;
    const through = (side: Held, contact: Contact) => {
      if (side.fitted) {
        const castor = of(side.fitted.stock, "castor");
        return { what: `${one(name(side.fitted.from))} plate`, mm: castor.plate.thickness.value };
      }
      return { what: one(side.piece?.name ?? ""), mm: extent(side.box, contact.across) };
    };
    const bolts = boltLength({
      thread: joint.bolt.diameter.value,
      length: joint.bolt.length.value,
      pitch: joint.bolt.pitch.value,
      have: options.have,
      through: [
        through(first.one, first.contact),
        through(first.other, first.contact),
        ...Array.from({ length: joint.washer.perBolt }, () => ({
          what: `${thread} washer`,
          mm: joint.washer.thickness.value,
        })),
        { what: `${thread} lock nut`, mm: joint.nut.height.value },
      ],
    });
    const count = joint.each * contacts.length;
    // The price given is for the bolts given, so the longer ones to use have none yet.
    const corrected = bolts.use !== joint.bolt.length.value;
    add({
      name: `${thread} × ${bolts.use} bolts`,
      count,
      price: corrected ? undefined : joint.bolt.price,
      for: purpose,
      length: bolts.length,
    });
    add({
      name: `${thread} washers`,
      count: count * joint.washer.perBolt,
      price: joint.washer.price,
      for: purpose,
    });
    add({ name: `${thread} lock nuts`, count, price: joint.nut.price, for: purpose });
  });

  // A box's own panels and cleats, screwed along every edge where one meets the next.
  for (const group of recipe.groups) {
    if (group.kind !== "box") continue;
    const boxes = held(group.id);
    let count = 0;
    boxes.forEach((one, index) => {
      for (const other of boxes.slice(index + 1)) {
        const contact = contactOf(one.box, other.box);
        if (contact === null) continue;
        const edge = contact.face[alongOf(contact)];
        if (edge >= BOX_EDGE) count += screwsAlong(edge);
      }
    });
    const screws = fixing(group.fixing);
    add({
      name: screws.name,
      count,
      price: screws.price,
      for: `the ${said(name(group.id))}'s panels`,
    });
  }
  return problems.length > 0 ? err(problems) : ok([...lines.values()]);
};
