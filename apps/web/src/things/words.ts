import type { ThingSave } from "@courtyard/contract";

// How a Thing's fields read to the owner (ADR 0020).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** When a Thing was bought, in words: "9 Oct 2026", "Oct 2026" or "2026", from its file's date. */
export const boughtInWords = (bought: string) => {
  const [year, month, day] = bought.split("-");
  const monthName = month === undefined ? undefined : MONTHS[Number(month) - 1];
  if (monthName === undefined) return year ?? bought;
  return [day === undefined ? [] : [String(Number(day))], monthName, year].flat().join(" ");
};

/**
 * What a Thing save did, in a few words for its note: an added Thing's status and details, or the
 * fields a change set ("bought 9 Oct 2026, £32") and its history line.
 */
export const thingSaveWords = (save: ThingSave) => {
  if (save.action === "remove") return undefined;
  const { fields = {} } = save;
  const said = [
    ...(save.action === "add" && fields.status !== undefined ? [fields.status] : []),
    ...(save.action === "change" && fields.name !== undefined ? [`now ${fields.name}`] : []),
    ...(save.action === "change" && fields.status !== undefined ? [fields.status] : []),
    ...(["brand", "bought", "price", "condition", "size", "where", "partOf"] as const).flatMap(
      (field) => {
        const value = fields[field];
        if (value === undefined) return [];
        const named = field === "partOf" ? "part of" : field;
        if (value === null) return [`no ${named}`];
        if (field === "bought") return [`bought ${boughtInWords(value)}`];
        return [field === "partOf" ? `part of ${value}` : value];
      },
    ),
    ...(save.photo ? ["new photo"] : []),
  ];
  const parts = [
    ...(said.length === 0 ? [] : [said.join(", ")]),
    ...(save.history === undefined ? [] : [`history: ${save.history}`]),
  ];
  return parts.length === 0 ? undefined : parts.join("; ");
};
