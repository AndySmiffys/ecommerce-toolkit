import { useId, useState } from "react";

// Charts for the Reports pages, drawn as plain SVG in Shopify's analytics style. Shopify offers apps no native chart
// component, so these are an intended exception to "use native components". They have no dependencies, scale to the
// width they are given (so they work on a phone) and carry a text summary for screen readers.

export const chartColors = ["#2e72d2", "#8a5cf5", "#2fb39b", "#f08c3b", "#e0568a", "#9aa0a6"];
const lineColour = "#2e72d2";
const previousColour = "#a9c3ec";

const pathFor = (values: number[], x: (index: number) => number, y: (value: number) => number) => values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");

/** A small trend line for a headline figure. `previous` is drawn dotted behind it. */
export function Sparkline({ values, previous, label }: { values: number[]; previous?: number[] | null; label: string }) {
  const id = useId().replace(/:/g, "");
  const width = 200;
  const height = 44;
  const all = [...values, ...(previous ?? [])];
  const max = Math.max(1, ...all);
  const x = (index: number) => values.length < 2 ? width / 2 : (index / (values.length - 1)) * width;
  const y = (value: number) => height - 4 - (value / max) * (height - 8);
  const line = pathFor(values, x, y);
  return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} style={{ width: "100%", height: 44, display: "block" }} preserveAspectRatio="none">
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={lineColour} stopOpacity="0.22" /><stop offset="100%" stopColor={lineColour} stopOpacity="0" /></linearGradient></defs>
    {previous && previous.length > 1 && <path d={pathFor(previous, (index) => (index / (previous.length - 1)) * width, y)} fill="none" stroke={previousColour} strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
    {values.length > 1 && <path d={`${line} L${x(values.length - 1)},${height} L${x(0)},${height} Z`} fill={`url(#${id})`} />}
    <path d={line} fill="none" stroke={lineColour} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
  </svg>;
}

/** Rounds an upper limit up to a tidy number so the gridlines read well. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  const unit = value / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

/** The main trend chart: a filled line with the previous period dotted behind it, and a readout as the pointer moves over it. */
export function AreaChart({ values, previous, labels, previousLabels, format, axisFormat, label, height = 240 }: { values: number[]; previous?: number[] | null; labels: string[]; previousLabels?: string[]; format: (value: number) => string; axisFormat?: (value: number) => string; label: string; height?: number }) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const left = 56;
  const bottom = 26;
  const top = 12;
  const right = 10;
  const max = niceMax(Math.max(0, ...values, ...(previous ?? [])));
  const x = (index: number) => values.length < 2 ? (left + width - right) / 2 : left + (index / (values.length - 1)) * (width - left - right);
  const y = (value: number) => top + (1 - value / max) * (height - top - bottom);
  const line = pathFor(values, x, y);
  const ticks = [0, 0.5, 1].map(part => part * max);
  const labelAt = values.length <= 1 ? [0] : [0, Math.floor((values.length - 1) / 3), Math.floor(((values.length - 1) * 2) / 3), values.length - 1];
  const axis = axisFormat ?? format;
  function move(event: React.MouseEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const position = ((event.clientX - box.left) / box.width) * (width - left - right);
    setHover(Math.max(0, Math.min(values.length - 1, Math.round((position / (width - left - right)) * (values.length - 1)))));
  }
  const readout = hover === null ? null : { x: x(hover), text: [labels[hover], format(values[hover]), previous && previous[hover] !== undefined ? `Before: ${format(previous[hover])}${previousLabels?.[hover] ? ` (${previousLabels[hover]})` : ""}` : ""].filter(Boolean) };
  return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} style={{ width: "100%", height: "auto", display: "block" }}>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={lineColour} stopOpacity="0.25" /><stop offset="100%" stopColor={lineColour} stopOpacity="0.02" /></linearGradient></defs>
    {ticks.map(tick => <g key={tick}>
      <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} stroke="#e6e6e6" strokeWidth="1" />
      <text x={left - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#616161">{axis(tick)}</text>
    </g>)}
    {labelAt.map(index => <text key={index} x={x(index)} y={height - 6} textAnchor={index === 0 ? "start" : index === values.length - 1 ? "end" : "middle"} fontSize="11" fill="#616161">{labels[index]}</text>)}
    {previous && previous.length > 1 && <path d={pathFor(previous, (index) => left + (index / (previous.length - 1)) * (width - left - right), y)} fill="none" stroke={previousColour} strokeWidth="2" strokeDasharray="4 4" />}
    {values.length > 1 && <path d={`${line} L${x(values.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#${id})`} />}
    <path d={line} fill="none" stroke={lineColour} strokeWidth="2.5" strokeLinejoin="round" />
    {readout && hover !== null && <g pointerEvents="none">
      <line x1={readout.x} x2={readout.x} y1={top} y2={height - bottom} stroke="#8a8a8a" strokeDasharray="3 3" />
      <circle cx={readout.x} cy={y(values[hover])} r="4" fill={lineColour} stroke="#fff" strokeWidth="2" />
      <g transform={`translate(${Math.min(readout.x + 10, width - 150)}, ${top + 4})`}>
        <rect width="140" height={12 + readout.text.length * 15} rx="6" fill="#303030" opacity="0.94" />
        {readout.text.map((text, index) => <text key={index} x="9" y={17 + index * 15} fontSize="11" fill="#fff" fontWeight={index === 1 ? 650 : 400}>{text}</text>)}
      </g>
    </g>}
    <rect x={left} y={top} width={width - left - right} height={height - top - bottom} fill="transparent" onMouseMove={move} onMouseLeave={() => setHover(null)} />
  </svg>;
}

/** A slice of a donut. `hint` explains it on hover, for a slice that is not a plain name (such as a catch-all). */
export type Slice = { label: string; value: number; note?: string; hint?: string };

/** A donut with its legend: each slice's value and share. */
export function Donut({ slices, centreLabel, centreValue, format, label }: { slices: Slice[]; centreLabel: string; centreValue: string; format: (value: number) => string; label: string }) {
  const tipBase = useId().replace(/:/g, "");
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
    <svg viewBox="0 0 140 140" role="img" aria-label={label} style={{ width: 150, height: 150, flex: "0 0 auto" }}>
      <circle cx="70" cy="70" r={radius} fill="none" stroke="#f1f1f1" strokeWidth="18" />
      {total > 0 && slices.map((slice, index) => {
        const length = (Math.max(0, slice.value) / total) * circumference;
        const circle = <circle key={slice.label} cx="70" cy="70" r={radius} fill="none" stroke={chartColors[index % chartColors.length]} strokeWidth="18" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)" />;
        offset += length;
        return circle;
      })}
      <text x="70" y="66" textAnchor="middle" fontSize="11" fill="#616161">{centreLabel}</text>
      <text x="70" y="86" textAnchor="middle" fontSize="18" fontWeight="650" fill="#303030">{centreValue}</text>
    </svg>
    <div style={{ flex: "1 1 160px", minWidth: 0, display: "grid", gap: 8 }}>
      {slices.map((slice, index) => <div key={slice.label} style={{ display: "grid", gridTemplateColumns: "12px minmax(0, 1fr) auto auto", gap: 8, alignItems: "center", fontSize: 13 }}>
        <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: chartColors[index % chartColors.length] }} />
        <span style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={slice.hint ? undefined : slice.label}>{slice.label}</span>
          {slice.hint && <>
            <s-button type="button" variant="tertiary" icon="info" interestFor={`${tipBase}-tip-${index}`} accessibilityLabel={`About ${slice.label}`} />
            <s-tooltip id={`${tipBase}-tip-${index}`}>{slice.hint}</s-tooltip>
          </>}
        </span>
        <span style={{ fontWeight: 600 }}>{format(slice.value)}</span>
        <span style={{ color: "#616161", minWidth: 40, textAlign: "right" }}>{total > 0 ? `${((Math.max(0, slice.value) / total) * 100).toFixed(0)}%` : "–"}</span>
      </div>)}
    </div>
  </div>;
}

export type BarItem = { label: string; value: number; note?: string };

/** Horizontal bars, biggest first, like Shopify's "by location" lists. */
export function BarList({ items, format, empty }: { items: BarItem[]; format: (value: number) => string; empty: string }) {
  const max = Math.max(1, ...items.map(item => item.value));
  if (!items.length) return <s-text color="subdued">{empty}</s-text>;
  return <div style={{ display: "grid", gap: 12 }}>
    {items.map(item => <div key={item.label} style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.label}>{item.label}</span>
        <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{format(item.value)}{item.note ? <span style={{ color: "#616161", fontWeight: 400 }}> · {item.note}</span> : null}</span>
      </div>
      <div aria-hidden="true" style={{ height: 8, borderRadius: 4, background: "#f1f1f1" }}>
        <div style={{ width: `${Math.max(2, (item.value / max) * 100)}%`, height: 8, borderRadius: 4, background: lineColour }} />
      </div>
    </div>)}
  </div>;
}
