import { Chart } from "@courtyard/contract";
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./stylesheet.ts";
import { formatValue, type Scale, scaleFor } from "./chart-scale.ts";
import type { DrawingProps } from "./fenced.tsx";

/** Each series' colour (or each slice's), in order: Moorland's heather, then the workspace colours. */
const COLOURS = [
  { fill: "fill-primary", stroke: "stroke-primary", swatch: "bg-primary" },
  { fill: "fill-workspace-slate", stroke: "stroke-workspace-slate", swatch: "bg-workspace-slate" },
  { fill: "fill-workspace-moss", stroke: "stroke-workspace-moss", swatch: "bg-workspace-moss" },
  {
    fill: "fill-workspace-bracken",
    stroke: "stroke-workspace-bracken",
    swatch: "bg-workspace-bracken",
  },
  { fill: "fill-workspace-peat", stroke: "stroke-workspace-peat", swatch: "bg-workspace-peat" },
] as const;

const colour = (index: number) => COLOURS[index % COLOURS.length] ?? COLOURS[0];

/** The chart's JSON, when it's a chart Courtyard can draw. */
const chartFrom = (source: string) => {
  try {
    const parsed = Chart.safeParse(JSON.parse(source));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/**
 * A `chart` block (ADR 0021): a bar, line or pie chart drawn from the model's JSON in the theme's
 * colours, with its values written on it so nothing needs hovering on a phone. JSON that isn't a
 * chart shows the fallback, the source as the model wrote it.
 */
export default function ChartBlock(props: DrawingProps) {
  const chart = useMemo(() => chartFrom(props.source), [props.source]);
  if (chart === undefined) return props.fallback;
  const name =
    chart.title ?? `${chart.kind === "bar" ? "Bar" : chart.kind === "line" ? "Line" : "Pie"} chart`;
  const named = chart.series.length > 1 || chart.kind === "pie";
  return (
    <figure aria-label={name} className="rounded-md border bg-field p-4 md:p-5">
      {chart.title === undefined && chart.unit === undefined ? null : (
        <figcaption className="mb-3 flex items-baseline justify-between gap-3">
          <span className="text-[15px]/5 font-semibold">{chart.title}</span>
          {chart.unit === undefined ? null : (
            <span className="text-xs text-muted-foreground">{chart.unit}</span>
          )}
        </figcaption>
      )}
      {chart.kind === "pie" ? (
        <Pie labels={chart.labels} values={chart.series[0]?.values ?? []} />
      ) : (
        <>
          {named ? (
            <Legend
              items={chart.series.map((series, index) => series.name ?? `Series ${index + 1}`)}
            />
          ) : null}
          <Plot chart={chart} />
        </>
      )}
      <DataTable chart={chart} />
    </figure>
  );
}

type Plotted = Extract<Chart, { kind: "bar" | "line" }>;

/** Room for the values over the plot, the plot itself, and the labels under it. */
const ABOVE = 20;
const PLOT_HEIGHT = 160;
const BELOW = 26;
/** The narrowest a label's slot gets before the chart scrolls sideways instead. */
const SLOT_MIN = 40;
/** Each bar's widest, and its narrowest beside others. */
const BAR_MAX = 56;
const BAR_MIN = 18;

/** How wide the element is, as the page lays it out. */
const useWidth = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
};

/** A bar from the baseline to `end`, its far corners rounded. */
const barPath = (left: number, width: number, base: number, end: number) => {
  const up = end <= base;
  const round = Math.min(3, width / 2, Math.abs(base - end));
  const corner = up ? end + round : end - round;
  const right = left + width;
  return [
    `M${left},${base}`,
    `V${corner}`,
    `Q${left},${end} ${left + round},${end}`,
    `H${right - round}`,
    `Q${right},${end} ${right},${corner}`,
    `V${base}`,
    "Z",
  ].join(" ");
};

/** A bar or line chart: its value axis on the left, a slot per label, scrolling if it's crowded. */
function Plot(props: { chart: Plotted }) {
  const { chart } = props;
  const { ref, width } = useWidth();
  const bars = chart.kind === "bar";
  const scale = scaleFor(
    chart.series.flatMap((series) => series.values),
    bars,
  );
  const axis = Math.max(28, ...scale.ticks.map((tick) => formatValue(tick).length * 7 + 8));
  // Room for the longest label, at about 7 px a character, and for each series' bar side by side.
  const slotMin = Math.max(
    SLOT_MIN,
    ...chart.labels.map((label) => label.length * 7 + 8),
    bars ? chart.series.length * (BAR_MIN + 2) + 12 : 0,
  );
  const plotWidth = Math.max((width ?? 0) - axis, chart.labels.length * slotMin);
  const slot = plotWidth / chart.labels.length;
  const y = (value: number) =>
    ABOVE + PLOT_HEIGHT - ((value - scale.low) / (scale.high - scale.low)) * PLOT_HEIGHT;
  const base = y(Math.min(Math.max(0, scale.low), scale.high));
  const height = ABOVE + PLOT_HEIGHT + BELOW;
  return (
    <div ref={ref} className="overflow-x-auto">
      {width === undefined ? (
        <div style={{ height }} />
      ) : (
        <svg
          aria-hidden
          width={axis + plotWidth}
          height={height}
          className="block font-sans text-[12px]"
        >
          <Ticks scale={scale} y={y} axis={axis} right={axis + plotWidth} />
          {chart.labels.map((label, index) => (
            <text
              // biome-ignore lint/suspicious/noArrayIndexKey: labels are the model's, and may repeat
              key={index}
              x={axis + slot * (index + 0.5)}
              y={ABOVE + PLOT_HEIGHT + 19}
              textAnchor="middle"
              className="fill-muted-foreground text-xs"
            >
              {label}
            </text>
          ))}
          {bars ? (
            <Bars chart={chart} slot={slot} axis={axis} y={y} base={base} />
          ) : (
            <Lines chart={chart} slot={slot} axis={axis} y={y} />
          )}
          <line
            x1={axis}
            x2={axis + plotWidth}
            y1={base}
            y2={base}
            className="stroke-muted-foreground"
          />
        </svg>
      )}
    </div>
  );
}

/** The round values up the left, each ruled faintly across. */
function Ticks(props: { scale: Scale; y: (value: number) => number; axis: number; right: number }) {
  return props.scale.ticks.map((tick) => (
    <g key={tick}>
      <line
        x1={props.axis}
        x2={props.right}
        y1={props.y(tick)}
        y2={props.y(tick)}
        className="stroke-border"
      />
      <text
        x={props.axis - 8}
        y={props.y(tick) + 4}
        textAnchor="end"
        className="fill-muted-foreground"
      >
        {formatValue(tick)}
      </text>
    </g>
  ));
}

type Placed = {
  chart: Plotted;
  slot: number;
  axis: number;
  y: (value: number) => number;
};

/** A bar per value, each series side by side in a label's slot, its value written beyond it. */
function Bars(props: Placed & { base: number }) {
  const { chart, slot, axis, y, base } = props;
  const count = chart.series.length;
  const bar = count === 1 ? Math.min(BAR_MAX, slot * 0.48) : Math.min(32, (slot * 0.76) / count);
  return chart.series.map((series, seriesIndex) =>
    series.values.map((value, index) => {
      const left = axis + slot * (index + 0.5) - (bar * count) / 2 + bar * seriesIndex;
      const end = y(value);
      return (
        // A label's slot holds one bar from each series, in order.
        // biome-ignore lint/suspicious/noArrayIndexKey: a value's place is what it is
        <g key={`${seriesIndex}-${index}`}>
          <path
            data-series={seriesIndex}
            d={barPath(left + (count === 1 ? 0 : 1), bar - (count === 1 ? 0 : 2), base, end)}
            className={colour(seriesIndex).fill}
          />
          <text
            x={left + bar / 2}
            y={end <= base ? end - 6 : end + 14}
            textAnchor="middle"
            className="fill-foreground font-semibold"
          >
            {formatValue(value)}
          </text>
        </g>
      );
    }),
  );
}

/** A line per series through its values, a dot on each; one series has its values written on. */
function Lines(props: Placed) {
  const { chart, slot, axis, y } = props;
  const x = (index: number) => axis + slot * (index + 0.5);
  return chart.series.map((series, seriesIndex) => {
    const { stroke, fill } = colour(seriesIndex);
    const last = series.values.length - 1;
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: series are in the model's order
      <g key={seriesIndex}>
        <polyline
          points={series.values.map((value, index) => `${x(index)},${y(value)}`).join(" ")}
          fill="none"
          strokeWidth={2.5}
          strokeLinejoin="round"
          className={stroke}
        />
        {series.values.map((value, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a value's place is what it is
          <g key={index}>
            <circle
              data-series={seriesIndex}
              cx={x(index)}
              cy={y(value)}
              r={4}
              strokeWidth={2}
              className={`${fill} stroke-field`}
            />
            {chart.series.length === 1 || index === last ? (
              <text
                x={x(index)}
                y={y(value) - 9}
                textAnchor="middle"
                className="fill-foreground font-semibold"
              >
                {formatValue(value)}
              </text>
            ) : null}
          </g>
        ))}
      </g>
    );
  });
}

/** What each colour stands for: the series, or a pie's slices with their values. */
function Legend(props: {
  items: readonly ReactNode[];
  /** One under another, beside a pie, rather than in a row above the plot. */
  stacked?: boolean;
}) {
  return (
    <ul
      className={
        props.stacked
          ? "flex flex-col gap-2 text-xs text-muted-foreground"
          : "mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground"
      }
    >
      {props.items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: items are in the model's order
        <li key={index} className="flex items-center gap-1.5">
          <span aria-hidden className={`size-2.5 shrink-0 rounded-sm ${colour(index).swatch}`} />
          {item}
        </li>
      ))}
    </ul>
  );
}

const PIE_RADIUS = 72;
/** The pie's middle, leaving room for the outline between slices at its edge. */
const PIE_MIDDLE = PIE_RADIUS + 2;

/** A point on the pie's edge, `share` of the way round from the top, clockwise. */
const edge = (share: number) => {
  const angle = share * 2 * Math.PI;
  return [PIE_MIDDLE + PIE_RADIUS * Math.sin(angle), PIE_MIDDLE - PIE_RADIUS * Math.cos(angle)];
};

/** Parts of a whole: a slice per label, and beside it each label's value and share. */
function Pie(props: { labels: readonly string[]; values: readonly number[] }) {
  const total = props.values.reduce((sum, value) => sum + value, 0);
  let before = 0;
  const slices = props.values.map((value) => {
    const from = before / total;
    before += value;
    return { from, to: before / total };
  });
  const size = PIE_MIDDLE * 2;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
      <svg aria-hidden width={size} height={size} className="block shrink-0">
        {slices.map(({ from, to }, index) => {
          const { fill } = colour(index);
          const shared = {
            "data-series": index,
            strokeWidth: 2,
            className: `${fill} stroke-field`,
          };
          if (to - from >= 1)
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: slices are in the model's order
              <circle key={index} cx={PIE_MIDDLE} cy={PIE_MIDDLE} r={PIE_RADIUS} {...shared} />
            );
          const [startX, startY] = edge(from);
          const [endX, endY] = edge(to);
          const large = to - from > 0.5 ? 1 : 0;
          return (
            <path
              // biome-ignore lint/suspicious/noArrayIndexKey: slices are in the model's order
              key={index}
              d={`M${PIE_MIDDLE},${PIE_MIDDLE} L${startX},${startY} A${PIE_RADIUS},${PIE_RADIUS} 0 ${large} 1 ${endX},${endY} Z`}
              {...shared}
            />
          );
        })}
      </svg>
      <Legend
        stacked
        items={props.labels.map((label, index) => {
          const value = props.values[index] ?? 0;
          return (
            <>
              {label}
              <span className="font-semibold text-foreground">{formatValue(value)}</span>
              <span>{Math.round((value / total) * 100)}%</span>
            </>
          );
        })}
      />
    </div>
  );
}

/** The chart's numbers as a table, for a screen reader: the drawing itself is hidden from one. */
function DataTable(props: { chart: Chart }) {
  const { chart } = props;
  return (
    <table className="sr-only">
      <thead>
        <tr>
          <th scope="col">{chart.title ?? "Label"}</th>
          {chart.series.map((series, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: series are in the model's order
            <th key={index} scope="col">
              {series.name ?? (chart.unit === undefined ? "Value" : `Value (${chart.unit})`)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {chart.labels.map((label, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: labels are the model's, and may repeat
          <tr key={index}>
            <th scope="row">{label}</th>
            {chart.series.map((series, seriesIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: series are in the model's order
              <td key={seriesIndex}>{formatValue(series.values[index] ?? 0)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
