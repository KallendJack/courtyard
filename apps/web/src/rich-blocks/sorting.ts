/** How a table is sorted: by one column, up or down, or not at all (as the model wrote it). */
export type Sort =
  | { readonly column: number; readonly direction: "ascending" | "descending" }
  | undefined;

/** The sort after a tap on a column's heading: up, then down, then back as written. */
export const nextSort = (sort: Sort, column: number): Sort => {
  if (sort?.column !== column) return { column, direction: "ascending" };
  return sort.direction === "ascending" ? { column, direction: "descending" } : undefined;
};

/** A cell that says there's nothing there, which sorts last whichever way the column goes. */
const BLANK = /^(|[-–—?]|n\/?a)$/i;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?`;
const DAY = String.raw`(\d{1,2})(?:st|nd|rd|th)?`;
const WEEKDAY = String.raw`(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?`;

/** The dates models write, as patterns whose groups are found by name below. */
const DATES: readonly { pattern: RegExp; year?: number; month?: number; day?: number }[] = [
  // 2026-10-09, 2026-10
  { pattern: /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/, year: 1, month: 2, day: 3 },
  // 9 Oct 2026, Tue 13 October, 9th Oct
  {
    pattern: new RegExp(`^${WEEKDAY}${DAY}\\s+${MONTH},?(?:\\s+(\\d{4}))?$`, "i"),
    day: 1,
    month: 2,
    year: 3,
  },
  // Oct 9, 2026
  {
    pattern: new RegExp(`^${WEEKDAY}${MONTH}\\s+${DAY},?(?:\\s+(\\d{4}))?$`, "i"),
    month: 1,
    day: 2,
    year: 3,
  },
  // Oct 2026, October
  { pattern: new RegExp(`^${MONTH}(?:\\s+(\\d{4}))?$`, "i"), month: 1, year: 2 },
  // 09/10/2026, day first, as the owner writes it
  { pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, day: 1, month: 2, year: 3 },
];

/** A date's place in time, a number that sorts as the dates do; a missing day or year counts as 0. */
const dateKey = (text: string): number | undefined => {
  for (const date of DATES) {
    const found = date.pattern.exec(text);
    if (found === null) continue;
    const part = (group: number | undefined) =>
      group === undefined ? undefined : found[group]?.toLowerCase();
    const month = part(date.month) ?? "";
    const monthNumber = /^\d+$/.test(month) ? Number(month) : MONTHS.indexOf(month.slice(0, 3)) + 1;
    const day = Number(part(date.day) ?? 0);
    if (monthNumber < 1 || monthNumber > 12 || day > 31) return undefined;
    return Number(part(date.year) ?? 0) * 10_000 + monthNumber * 100 + day;
  }
  return undefined;
};

/**
 * A number, a price or a measure: "£1,400", "about £200", "365 g", "-3.5%", "£1.2k". Its unit may
 * be any letters or symbols after it, but nothing else may follow, so "11-speed" or "£95–£110"
 * isn't one.
 */
const NUMBER =
  /^(?:(?:about|around|approx\.?|c\.|~|≈)\s*)?([-−+]?)\s*[£$€¥]?\s*([-−]?)(\d{1,3}(?:,\d{3})+|\d+)?(\.\d+)?\s*([\p{L}%°'"″′/.²³µ ]*)$/u;

const numberKey = (text: string): number | undefined => {
  const found = NUMBER.exec(text);
  if (found === null) return undefined;
  const [, sign = "", innerSign = "", whole, fraction, unit = ""] = found;
  if (whole === undefined && fraction === undefined) return undefined;
  const value = Number(`${whole?.replaceAll(",", "") ?? "0"}${fraction ?? ""}`);
  const negative = /[-−]/.test(sign + innerSign);
  const thousands = /^k$/i.test(unit.trim()) ? 1000 : 1;
  return (negative ? -value : value) * thousands;
};

const words = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * The order to show a table's rows in, as indexes into `rows` (each row its cells' text). A
 * column sorts as dates when every cell in it is one, as numbers (prices and measures too) when
 * every cell is one, and as text otherwise, with numbers in text in their order ("Week 2" before
 * "Week 10"). Blank cells go last either way; rows that tie keep the order they were written in.
 */
export const sortedOrder = (rows: readonly (readonly string[])[], sort: Sort): number[] => {
  const order = rows.map((_, index) => index);
  if (sort === undefined) return order;
  const cells = rows.map((row) => (row[sort.column] ?? "").trim());
  const filled = cells.filter((cell) => !BLANK.test(cell));
  const asKeys = (key: (text: string) => number | undefined) => {
    const keys = cells.map((cell) => (BLANK.test(cell) ? undefined : key(cell)));
    return filled.length > 0 && keys.filter((value) => value !== undefined).length === filled.length
      ? keys
      : undefined;
  };
  const keys = asKeys(dateKey) ?? asKeys(numberKey);
  const compare = (a: number, b: number) =>
    keys === undefined
      ? words.compare(cells[a] ?? "", cells[b] ?? "")
      : (keys[a] ?? 0) - (keys[b] ?? 0);
  const flip = sort.direction === "ascending" ? 1 : -1;
  return order.sort((a, b) => {
    const blankA = BLANK.test(cells[a] ?? "");
    const blankB = BLANK.test(cells[b] ?? "");
    if (blankA || blankB) return Number(blankA) - Number(blankB);
    return compare(a, b) * flip;
  });
};
