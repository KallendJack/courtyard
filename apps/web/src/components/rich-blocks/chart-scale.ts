/** How a chart's numbers read: grouped thousands, at most two decimal places. */
const NUMBER = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

export const formatValue = (value: number) => NUMBER.format(value);

/** Rounds away a sum's floating-point dust, so 0.1 × 3 reads as 0.3. */
const tidy = (value: number) => Number(value.toPrecision(12));

/** A round step (1, 2, 2.5 or 5 times a power of ten) that splits `span` into about four. */
const roundStep = (span: number) => {
  const rough = span / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const multiple = rough / power;
  const round =
    multiple <= 1 ? 1 : multiple <= 2 ? 2 : multiple <= 2.5 ? 2.5 : multiple <= 5 ? 5 : 10;
  return round * power;
};

/** A chart's value axis: its lowest and highest values, and the round values ruled across it. */
export type Scale = {
  readonly low: number;
  readonly high: number;
  readonly ticks: readonly number[];
};

/**
 * The value axis for `values`, in round steps from below the lowest to above the highest. Bars
 * always start from zero; a line keeps to its values, unless zero is near them anyway.
 */
export const scaleFor = (values: readonly number[], fromZero: boolean): Scale => {
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (fromZero || (low >= 0 && low <= high - low)) low = Math.min(0, low);
  if (fromZero) high = Math.max(0, high);
  if (low === high) {
    // One value, or all the same: give it room above (and below, for a line away from zero).
    high = low === 0 ? 1 : high + Math.abs(high) / 2;
    if (!fromZero && low !== 0) low -= Math.abs(low) / 2;
  }
  const step = roundStep(high - low);
  const first = Math.floor(tidy(low / step)) * step;
  const last = Math.ceil(tidy(high / step)) * step;
  const ticks: number[] = [];
  for (let at = first; at <= last + step / 2; at += step) ticks.push(tidy(at));
  return { low: tidy(first), high: tidy(last), ticks };
};
