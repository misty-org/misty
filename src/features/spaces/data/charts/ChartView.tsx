import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReactElement } from "react";
import { Text } from "@misty/ui";
import type { ChartData } from "./chartData";

/**
 * The series colors: content, not chrome, so they're fixed rather than the theme's. The
 * Okabe–Ito palette, told apart with the common kinds of color blindness, readable on light and
 * dark pages alike.
 */
export const seriesPalette = [
  "#0072B2",
  "#E69F00",
  "#009E73",
  "#CC79A7",
  "#56B4E9",
  "#D55E00",
] as const;

export const seriesColor = (index: number) => seriesPalette[index % seriesPalette.length];

const axis = {
  stroke: "currentColor",
  strokeOpacity: 0.25,
  tick: { fill: "currentColor", fontSize: 12 },
  tickLine: false,
};
const grid = { stroke: "currentColor", strokeOpacity: 0.1, vertical: false };
const tooltipStyle = {
  contentStyle: { borderRadius: 8, fontSize: 13 },
  cursor: { fill: "currentColor", fillOpacity: 0.06 },
};

function rowsOf(data: ChartData) {
  return data.categories.map((category, index) => {
    const row: Record<string, string | number | null> = { category };
    data.series.forEach((series, at) => {
      row[`s${at}`] = series.values[index] ?? null;
    });
    return row;
  });
}

/** A stat tile's one number, large, with what it counts under it. */
export function StatValue(props: { data: ChartData }) {
  return (
    <div className="flex h-full min-h-0 flex-col justify-end gap-1">
      <Text size="display" weight="semibold" tone="bright" className="tabular-nums">
        {props.data.display ?? "—"}
      </Text>
    </div>
  );
}

/**
 * A chart drawn with Recharts (MIT): axes and grid in the page's own muted ink, series in the
 * fixed palette. `animate` is off for exports, so the picture is the finished chart.
 */
export function ChartView(props: { data: ChartData; animate?: boolean }) {
  const { data } = props;
  const animate = props.animate !== false;
  if (data.type === "stat") return <StatValue data={data} />;
  if (data.problem)
    return (
      <div className="flex h-full items-center justify-center">
        <Text size="control" tone="muted">
          {data.problem === "removed" ? "Its cells were removed." : "Its range has no numbers yet."}
        </Text>
      </div>
    );
  const rows = rowsOf(data);
  const legend =
    data.series.length > 1 ? <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} /> : null;
  const series = data.series.map((item, index) => ({
    key: `s${index}`,
    name: item.name,
    color: seriesColor(index),
  }));

  let chart: ReactElement;
  switch (data.type) {
    case "bar":
      chart = (
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid {...grid} vertical horizontal={false} />
          <XAxis type="number" {...axis} />
          <YAxis type="category" dataKey="category" width={96} {...axis} />
          <ChartTooltip {...tooltipStyle} />
          {legend}
          {series.map((item) => (
            <Bar
              key={item.key}
              dataKey={item.key}
              name={item.name}
              fill={item.color}
              radius={[0, 4, 4, 0]}
              isAnimationActive={animate}
            />
          ))}
        </BarChart>
      );
      break;
    case "line":
      chart = (
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...grid} />
          <XAxis dataKey="category" {...axis} />
          <YAxis width={48} {...axis} />
          <ChartTooltip {...tooltipStyle} />
          {legend}
          {series.map((item) => (
            <Line
              key={item.key}
              dataKey={item.key}
              name={item.name}
              stroke={item.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={animate}
            />
          ))}
        </LineChart>
      );
      break;
    case "area":
      chart = (
        <AreaChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...grid} />
          <XAxis dataKey="category" {...axis} />
          <YAxis width={48} {...axis} />
          <ChartTooltip {...tooltipStyle} />
          {legend}
          {series.map((item) => (
            <Area
              key={item.key}
              dataKey={item.key}
              name={item.name}
              stroke={item.color}
              fill={item.color}
              fillOpacity={0.2}
              strokeWidth={2}
              isAnimationActive={animate}
            />
          ))}
        </AreaChart>
      );
      break;
    case "pie":
    case "donut": {
      const slices = data.categories.map((category, index) => ({
        name: category,
        value: data.series[0]?.values[index] ?? 0,
      }));
      chart = (
        <PieChart>
          <ChartTooltip {...tooltipStyle} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius={data.type === "donut" ? "55%" : 0}
            outerRadius="80%"
            stroke="none"
            isAnimationActive={animate}
          >
            {slices.map((slice, index) => (
              <Cell key={`${slice.name}:${index}`} fill={seriesColor(index)} />
            ))}
          </Pie>
        </PieChart>
      );
      break;
    }
    case "scatter":
      chart = (
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...grid} vertical />
          <XAxis type="number" dataKey="x" name={data.categories.length ? "x" : ""} {...axis} />
          <YAxis type="number" dataKey="y" width={48} {...axis} />
          <ChartTooltip {...tooltipStyle} />
          {legend}
          {data.series.map((item, index) => (
            <Scatter
              key={`s${index}`}
              name={item.name}
              fill={seriesColor(index)}
              isAnimationActive={animate}
              data={data.categories
                .map((category, at) => ({ x: Number(category), y: item.values[at] }))
                .filter((point) => Number.isFinite(point.x) && point.y !== null)}
            />
          ))}
        </ScatterChart>
      );
      break;
    default:
      chart = (
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...grid} />
          <XAxis dataKey="category" {...axis} />
          <YAxis width={48} {...axis} />
          <ChartTooltip {...tooltipStyle} />
          {legend}
          {series.map((item) => (
            <Bar
              key={item.key}
              dataKey={item.key}
              name={item.name}
              fill={item.color}
              radius={[4, 4, 0, 0]}
              isAnimationActive={animate}
            />
          ))}
        </BarChart>
      );
  }
  return (
    <Text bare tone="muted" as="div" className="block h-full min-h-0 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {chart}
      </ResponsiveContainer>
    </Text>
  );
}
