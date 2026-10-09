import { z } from "zod";

// A chart a model writes in an answer or a document (ADR 0021): the JSON in a `chart` fenced
// block, which the web app draws itself. Only the chart's own lazily loaded drawing and the eval
// import this, so none of it is on the first load.

/** The most series a bar or line chart has, and the most slices a pie has: one colour each. */
export const CHART_MAX_COLOURS = 5;

/** The most labels a chart has, so it stays readable (a wide one scrolls sideways). */
export const CHART_MAX_LABELS = 50;

/** One set of values, a value for each of the chart's labels in turn. */
const ChartSeries = z.object({
  /** What the values are, for the legend: needed only when there's more than one series. */
  name: z.string().max(60).optional(),
  values: z.array(z.number()),
});

const ChartWords = {
  title: z.string().max(120).optional(),
  /** What the values are counted in, such as `£` or `kg`. */
  unit: z.string().max(20).optional(),
  labels: z.array(z.string().max(60)).min(1).max(CHART_MAX_LABELS),
};

/** Bars to compare amounts, or lines for values that change: one or more series. */
const PlottedChart = z.object({
  kind: z.enum(["bar", "line"]),
  ...ChartWords,
  series: z.array(ChartSeries).min(1).max(CHART_MAX_COLOURS),
});

/** Parts of a whole: one series, a slice per label. */
const PieChart = z.object({
  kind: z.literal("pie"),
  ...ChartWords,
  labels: ChartWords.labels.max(CHART_MAX_COLOURS),
  series: z.array(ChartSeries).length(1),
});

/** A `chart` block's JSON: a bar, line or pie chart, its labels and its series. */
export const Chart = z
  .discriminatedUnion("kind", [PlottedChart, PieChart])
  .refine(
    (chart) => chart.series.every((series) => series.values.length === chart.labels.length),
    "Every series needs a value for each label.",
  )
  .refine(
    (chart) =>
      chart.kind !== "pie" ||
      chart.series.every(
        (series) =>
          series.values.every((value) => value >= 0) && series.values.some((value) => value > 0),
      ),
    "A pie's values are parts of a whole: none below zero, and not all zero.",
  );
export type Chart = z.infer<typeof Chart>;
