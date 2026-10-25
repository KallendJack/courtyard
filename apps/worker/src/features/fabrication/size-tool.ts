import {
  ObservedDay,
  type RecordSource,
  RecordSourceKind,
  RecordUnit,
  type SessionId,
  type SizeRecordId,
  type SizeValue,
  ThingSlug,
} from "@courtyard/contract";
import { z } from "zod";
import { err, ok, type Result } from "../../lib/result.ts";
import type { PlanningFilesTarget } from "../planning-files/index.ts";
import { historyDate, labelledThings, type ReadThing } from "../things/index.ts";
import {
  conflictsOf,
  type ReadSize,
  readSizes,
  type SizeEdit,
  type SizeRefusal,
  type SizeSaved,
  saveSize,
  standing,
} from "./sizes.ts";

/** A standing record with the label a model knows it by (`Z1`), oldest first. */
export type LabelledSize = { readonly label: string; readonly size: ReadSize };

/** Labels for a workspace's standing records, `Z1` first, oldest first. */
export const labelledSizes = (sizes: readonly ReadSize[]): LabelledSize[] =>
  sizes.filter(standing).map((size, index) => ({ label: `Z${index + 1}`, size }));

/** A label as a model might write it: `Z2`, `[Z2]` or `z2`. */
const asLabel = (raw: string) =>
  raw
    .trim()
    .replace(/^\[(.*)\]$/, "$1")
    .toUpperCase();

/** What a model sends the size tool, checked like anything else a model sends. */
const SizeRequest = z.strictObject({
  size: z.string().optional(),
  revision: z.number().int().positive().optional(),
  thing: z.string().optional(),
  property: z.string().optional(),
  amount: z.number().optional(),
  unit: RecordUnit.optional(),
  text: z.string().optional(),
  yes: z.boolean().optional(),
  source: RecordSourceKind,
  reference: z.string().optional(),
  observed: ObservedDay.optional(),
});

/** An input left as `null` is one not given, as some models send them. */
const withoutNulls = (raw: unknown) =>
  raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== null))
    : raw;

/** Why the size tool didn't save. */
export type SizeToolRefusal =
  | Exclude<SizeRefusal, { kind: "stale" } | { kind: "unchanged" }>
  | { readonly kind: "malformed" }
  /** Not exactly one of an amount with its unit, a text, or yes. */
  | { readonly kind: "no-value" }
  /** A new size with no Thing or property, or a correction with no revision. */
  | { readonly kind: "incomplete" }
  | { readonly kind: "unknown-label"; readonly label: string }
  | { readonly kind: "unknown-thing"; readonly thing: string }
  /** Specified with no maker's page. */
  | { readonly kind: "no-reference" }
  /** Measured, but the owner never gave that value in this conversation, or gave it only roughly. */
  | { readonly kind: "not-said"; readonly roughly: boolean }
  /** The record changed since the revision read: the records now, labelled afresh. */
  | { readonly kind: "stale"; readonly label: string; readonly sizes: readonly LabelledSize[] }
  | { readonly kind: "stopped" };

/**
 * What the size tool did: saved a record, or found it recorded already; the record, its label,
 * and the standing records it conflicts with, by label.
 */
export type SizeToolDone = (
  | { readonly kind: "saved"; readonly saved: SizeSaved }
  | { readonly kind: "unchanged" }
) & {
  readonly size: ReadSize;
  readonly label: string;
  readonly conflicts: readonly LabelledSize[];
};

/** Millimetres in each length unit; the other units aren't converted. */
const MM: Readonly<Record<string, number>> = { mm: 1, cm: 10, m: 1000 };

/** A number as a message writes it, and the unit after it, if any. */
const NUMBER = /(\d+(?:\.\d+)?)(\s*(?:mm|cm|metres?|m|kg|litres?|l|°)(?![a-z]))?/gi;

/** A word by a number saying it's rough: "about 140", "I reckon 140", "140-ish", "140 or so". */
const ROUGH_BEFORE =
  /(?:about|around|roughly|approx\w*|circa|nearly|almost|maybe|perhaps|guess|reckon|~)\W*(?:\w+\W+)?$/i;
const ROUGH_AFTER = /^\s*(?:-?ish\b|or so\b)/i;

/** A unit as a message writes it, as a record's: `metres` is `m`, `°` is `deg`. */
const unitOf = (written: string) => {
  const word = written.trim().toLowerCase();
  return word.startsWith("metre")
    ? "m"
    : word.startsWith("litre")
      ? "l"
      : word === "°"
        ? "deg"
        : word;
};

/**
 * How a message gives a quantity: exactly, only roughly, or not at all. A number with a length
 * unit counts in any length unit (5.137 m is 5137 mm); one with none counts in the record's unit,
 * or, for a length, as millimetres, centimetres or metres of it ("71.5 by 62" is 715 mm).
 */
export const givenIn = (
  text: string,
  value: SizeValue & { kind: "quantity" },
): "exactly" | "roughly" | "not" => {
  const plain = text.replace(/(\d),(\d{3})\b/g, "$1$2");
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(Math.abs(b) * 1e-6, 1e-9);
  const own = MM[value.unit];
  let rough = false;
  for (const match of plain.matchAll(NUMBER)) {
    const n = Number(match[1]);
    const theirs = match[2] === undefined ? undefined : unitOf(match[2]);
    const scale = theirs === undefined ? undefined : MM[theirs];
    const same =
      near(n, value.value) && (theirs === undefined || theirs === value.unit)
        ? true
        : own === undefined
          ? false
          : theirs === undefined
            ? [1, 10, 1000].some((k) => near((n * k) / own, value.value))
            : scale !== undefined && near((n * scale) / own, value.value);
    if (!same) continue;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (ROUGH_BEFORE.test(plain.slice(Math.max(0, start - 24), start))) rough = true;
    else if (ROUGH_AFTER.test(plain.slice(end, end + 10))) rough = true;
    else return "exactly";
  }
  return rough ? "roughly" : "not";
};

/** The owner's messages in the session, by event number, newest last. */
export type OwnerMessages = () => Promise<
  readonly { readonly seq: number; readonly text: string }[]
>;

/**
 * One turn's size tool (docs/ai-conduct.md, Sizes): records a size of a Thing, or corrects a
 * record by the label and revision the model was shown. Measured is tied by the worker to the
 * owner's message that gave the value, the newest that gave it exactly; with none, it's refused.
 */
export const createTurnSizes = (
  target: PlanningFilesTarget & {
    readonly sessionId: SessionId;
    /** The records and Things as the turn's instructions listed them. */
    readonly shown: { readonly sizes: readonly ReadSize[]; readonly things: readonly ReadThing[] };
    readonly ownerMessages: OwnerMessages;
    readonly now: number;
  },
) => {
  let labels = new Map<string, SizeRecordId>();
  const show = (sizes: readonly ReadSize[]) => {
    labels = new Map(labelledSizes(sizes).map(({ label, size }) => [label, size.record.id]));
  };
  show(target.shown.sizes);
  const thingLabels = new Map(
    labelledThings(target.shown.things).map(({ label, thing }) => [label, thing.slug]),
  );
  const labelOf = (id: SizeRecordId) => [...labels].find(([, of]) => of === id)?.[0];

  return async (raw: unknown): Promise<Result<SizeToolDone, SizeToolRefusal>> => {
    const request = SizeRequest.safeParse(withoutNulls(raw));
    if (!request.success) return err({ kind: "malformed" });
    const sent = request.data;
    const values: SizeValue[] = [
      ...(sent.amount === undefined || sent.unit === undefined
        ? []
        : [{ kind: "quantity" as const, value: sent.amount, unit: sent.unit }]),
      ...(sent.text === undefined ? [] : [{ kind: "text" as const, text: sent.text }]),
      ...(sent.yes === undefined ? [] : [{ kind: "yes-no" as const, yes: sent.yes }]),
    ];
    const [value] = values;
    if (
      value === undefined ||
      values.length > 1 ||
      (sent.amount === undefined) !== (sent.unit === undefined)
    ) {
      return err({ kind: "no-value" });
    }

    let source: RecordSource;
    if (sent.source === "specified") {
      const reference = sent.reference?.trim() ?? "";
      if (reference === "") return err({ kind: "no-reference" });
      source = { kind: "specified", reference };
    } else if (sent.source === "measured") {
      const messages = [...(await target.ownerMessages())].reverse();
      const quantity = value.kind === "quantity" ? value : undefined;
      const heard = messages.map((message) => ({
        message,
        given: quantity === undefined ? "exactly" : givenIn(message.text, quantity),
      }));
      const said = heard.find(({ given }) => given === "exactly")?.message;
      if (said === undefined) {
        return err({ kind: "not-said", roughly: heard.some(({ given }) => given === "roughly") });
      }
      source = { kind: "measured", said: { session: target.sessionId, seq: said.seq } };
    } else {
      source = { kind: sent.source };
    }
    const observed = sent.observed ?? historyDate(target.now);

    let edit: SizeEdit;
    let label: string | undefined;
    if (sent.size !== undefined && sent.size.trim() !== "") {
      label = asLabel(sent.size);
      const id = labels.get(label);
      if (id === undefined) return err({ kind: "unknown-label", label });
      if (sent.revision === undefined) return err({ kind: "incomplete" });
      edit = { kind: "correct", id, revision: sent.revision, value, source, observed };
    } else {
      if (sent.thing === undefined || sent.property === undefined) {
        return err({ kind: "incomplete" });
      }
      const named = sent.thing.trim();
      const slug =
        thingLabels.get(asLabel(named)) ??
        ThingSlug.safeParse(named.replace(/^things\//, "").replace(/\.md$/, "")).data;
      if (slug === undefined) return err({ kind: "unknown-thing", thing: named });
      edit = { kind: "add", thing: slug, property: sent.property.trim(), value, source, observed };
    }

    const saved = await saveSize(target, edit, { now: target.now });
    let size: ReadSize;
    if (saved.ok) {
      size = saved.value.size;
    } else if (saved.error.kind === "unchanged") {
      size = saved.error.size;
    } else if (saved.error.kind === "stale") {
      const now = await readSizes(target);
      if (!now.ok) return err({ kind: "storage" });
      show(now.value.sizes);
      return err({ kind: "stale", label: label ?? "", sizes: labelledSizes(now.value.sizes) });
    } else {
      return err(saved.error);
    }

    const now = await readSizes(target);
    if (!now.ok) return err({ kind: "storage" });
    // A correction's record takes the label of the one it corrected; a new one, the next.
    const was = edit.kind === "correct" ? labelOf(edit.id) : undefined;
    if (was !== undefined) labels.set(was, size.record.id);
    else if (labelOf(size.record.id) === undefined)
      labels.set(`Z${labels.size + 1}`, size.record.id);
    const others = conflictsOf(now.value.sizes).get(size.record.id) ?? [];
    const conflicts = now.value.sizes.flatMap((one) => {
      const of = labelOf(one.record.id);
      return others.includes(one.record.id) && of !== undefined ? [{ label: of, size: one }] : [];
    });
    const done = { size, label: labelOf(size.record.id) ?? "", conflicts };
    return ok(
      saved.ok ? { kind: "saved", saved: saved.value, ...done } : { kind: "unchanged", ...done },
    );
  };
};
