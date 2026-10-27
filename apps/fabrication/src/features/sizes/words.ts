import type { RecordSourceKind, SizeLine, SizeRecord, SizeValue } from "@courtyard/contract";

/** A source as a word (#709): measured, maker's page, about, estimated. */
export const sourceWord = (kind: RecordSourceKind) =>
  ({ measured: "measured", specified: "maker's page", reported: "about", estimated: "estimated" })[
    kind
  ];

/** A value as the owner reads it: `2656 mm`, `30°`, `block / dabs`, `yes`. */
export const valueWords = (value: SizeValue) =>
  value.kind === "quantity"
    ? value.unit === "deg"
      ? `${value.value}°`
      : `${value.value} ${value.unit}`
    : value.kind === "text"
      ? value.text
      : value.yes
        ? "yes"
        : "no";

/** A record's value, "about" in front when it was said roughly: `about 5050 mm`. */
export const recordValue = (record: Pick<SizeRecord, "value" | "source">) =>
  `${record.source.kind === "reported" ? "about " : ""}${valueWords(record.value)}`;

/** When a record was taken: "just now" within a few minutes of it, else its day, "24 Oct". */
export const whenWords = (record: Pick<SizeRecord, "observed" | "recorded">, now: number) =>
  now - Date.parse(record.recorded) < 5 * 60_000
    ? "just now"
    : new Date(`${record.observed}T12:00:00`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      });

/** What a line says under its name, and in which colour: what's happening with it now. */
export const lineState = (
  line: SizeLine,
  options: { readonly next: boolean; readonly now: number },
): { readonly words: string; readonly tone: "measured" | "needs" | "next" | "quiet" } => {
  const [record] = line.records;
  if (line.records.length > 1) {
    const answers = line.records.length === 2 ? "two" : `${line.records.length}`;
    return { words: `${answers} answers · check by tapping it`, tone: "needs" };
  }
  if (options.next) {
    return {
      words: ["measuring next", line.where].filter(Boolean).join(" · "),
      tone: "next",
    };
  }
  if (record === undefined) {
    return { words: ["to measure", line.where].filter(Boolean).join(" · "), tone: "needs" };
  }
  const source = sourceWord(record.source.kind);
  if (line.toMeasure) return { words: `${source} · to measure`, tone: "needs" };
  return {
    words: `${source} · ${whenWords(record, options.now)}`,
    tone: record.source.kind === "measured" ? "measured" : "quiet",
  };
};

/** The lines the guided re-measure goes through: the space's sizes it and its Builds need. */
export const remeasured = (lines: readonly SizeLine[]) =>
  lines.filter((line) => line.where !== null || line.builds.length > 0);
