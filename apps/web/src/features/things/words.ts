import { THING_DETAILS, type ThingSave, ThingStatus, type ThingSummary } from "@courtyard/contract";

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
 * When a Thing was bought, as its file keeps it, from what the owner typed in its form: words as
 * `boughtInWords` writes them ("9 Oct 2026", "Oct 2026", "2026"), or the file's own form, which
 * passes through as typed (and so does anything else, for the worker to say what's wrong).
 */
export const boughtFromWords = (typed: string) => {
  const words = typed.trim().split(/\s+/);
  const year = words.at(-1) ?? "";
  if (words.length < 2 || words.length > 3 || !/^\d{4}$/.test(year)) return typed.trim();
  const month = MONTHS.findIndex(
    (name) => name.toLowerCase() === words.at(-2)?.slice(0, 3).toLowerCase(),
  );
  if (month === -1) return typed.trim();
  const monthPart = `${year}-${String(month + 1).padStart(2, "0")}`;
  const day = words.length === 3 ? words[0] : undefined;
  if (day === undefined) return monthPart;
  return /^\d{1,2}$/.test(day) ? `${monthPart}-${day.padStart(2, "0")}` : typed.trim();
};

/** Each status as the owner reads it. */
export const STATUS_WORDS: Readonly<Record<ThingStatus, string>> = {
  have: "Have",
  want: "Want",
  replace: "Replace",
};

/** Each status as a choice, in the contract's order: the form's Status and the section's filter. */
export const STATUS_CHOICES = ThingStatus.options.map((status) => ({
  value: status,
  label: STATUS_WORDS[status],
}));

/**
 * A Thing's details on one line, for its row: its brand, when it was bought, its price, the shop
 * it came from and where it is, those it has. A part shown away from its Thing (when a filter
 * leaves that out) also says what it's part of.
 */
export const thingLine = (thing: ThingSummary, partOf?: string) =>
  [
    thing.brand,
    thing.bought === undefined ? undefined : `bought ${boughtInWords(thing.bought)}`,
    thing.price,
    thing.shop,
    thing.where,
    partOf === undefined ? undefined : `part of ${partOf}`,
  ]
    .filter((said) => said !== undefined)
    .join(" · ");

/**
 * Find a replacement's first message (#602): "Replace my pedals (Wellgo alloy flats)." The
 * Thing's name as the owner would say it (lower case, unless it's a name such as Whyte T-140),
 * then what's fitted, its brand and size, when it has them.
 */
export const replacementMessage = (thing: ThingSummary) => {
  const [first = "", ...rest] = thing.name.split(" ");
  const plain = /^[A-Z][a-z]*$/.test(first) && rest.every((word) => word === word.toLowerCase());
  const name = plain ? thing.name.toLowerCase() : thing.name;
  const fitted = [thing.brand, thing.size].filter((said) => said !== undefined).join(", ");
  return `Replace my ${name}${fitted === "" ? "" : ` (${fitted})`}.`;
};

/** A sum rounded up to one that reads as a budget: to £10 under £100, £50 under £500, else £100. */
const budgetSum = (sum: number) => {
  const step = sum < 100 ? 10 : sum < 500 ? 50 : 100;
  return Math.max(step, Math.ceil(sum / step) * step);
};

/**
 * Find a replacement's budgets to tap (#602): under what the Thing cost, rounded up, and up to
 * twice that, or under £50 and £50–100 when its price isn't known; and best value.
 */
export const budgetChoices = (thing: ThingSummary) => {
  const [, currency = "£", digits] =
    /([£$€])?\s*(\d[\d,]*(?:\.\d+)?)/.exec(thing.price ?? "") ?? [];
  const cost = digits === undefined ? undefined : Number(digits.replaceAll(",", ""));
  const under = cost === undefined || cost <= 0 ? 50 : budgetSum(cost);
  return [`Under ${currency}${under}`, `${currency}${under}–${under * 2}`, "Best value"];
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
    ...([...THING_DETAILS, "partOf"] as const).flatMap((field) => {
      const value = fields[field];
      if (value === undefined) return [];
      const named = field === "partOf" ? "part of" : field;
      if (value === null) return [`no ${named}`];
      if (field === "bought") return [`bought ${boughtInWords(value)}`];
      return [field === "partOf" ? `part of ${value}` : value];
    }),
    // A part's upcoming one (#602): its name, the rest of it on its card.
    ...(fields.upcoming === undefined
      ? []
      : [fields.upcoming === null ? "nothing upcoming" : `upcoming ${fields.upcoming}`]),
    ...(save.photo ? ["new photo"] : []),
  ];
  const parts = [
    ...(said.length === 0 ? [] : [said.join(", ")]),
    ...(save.history === undefined ? [] : [`history: ${save.history}`]),
  ];
  return parts.length === 0 ? undefined : parts.join("; ");
};
