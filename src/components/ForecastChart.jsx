import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

// The Sources panel's 48-hour chart (SOUP_PLAN.md item 27): rain chance as a
// filled area, cloud cover as a plain line, one shared 0-100% axis. Loaded
// lazily by StationDebugPanel (React.lazy), so uPlot is only downloaded once
// someone opens Sources. `data` comes from forecastChart.js.
//
// Colors: the dataviz reference palette's first two dark-mode slots, blue
// and orange, validated against the card surface (#2d1b4a) -- a pale
// "cloud" lavender was tried first and failed as reading gray. Text and grid
// use the panel's existing lavender text colors.
const RAIN_COLOR = "#3987e5";
const RAIN_FILL = "rgba(57, 135, 229, 0.35)";
const CLOUD_COLOR = "#d95926";
const TEXT_COLOR = "#d8cdf0";
const GRID_COLOR = "rgba(229, 217, 245, 0.12)";
const HEIGHT = 180;

function percentValue(_u, value) {
  return value == null ? "--" : `${Math.round(value)}%`;
}

function hourValue(_u, seconds) {
  return seconds == null
    ? "--"
    : new Date(seconds * 1000).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
}

// A dashed vertical line at the hour the "Decided by" line names, so the
// chart and that line point at the same thing.
function decidedMarker(marker) {
  return (u) => {
    if (marker == null) return;
    const x = Math.round(u.valToPos(marker, "x", true));
    const { top, height, left, width } = u.bbox;
    if (x < left || x > left + width) return;
    const ratio = window.devicePixelRatio || 1;
    const { ctx } = u;
    ctx.save();
    ctx.strokeStyle = TEXT_COLOR;
    ctx.lineWidth = ratio;
    ctx.setLineDash([4 * ratio, 4 * ratio]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = `${11 * ratio}px system-ui, sans-serif`;
    // Label on whichever side has room.
    const label = "decided by";
    const labelWidth = ctx.measureText(label).width;
    const onLeft = x + 4 * ratio + labelWidth > left + width;
    ctx.textAlign = onLeft ? "right" : "left";
    ctx.textBaseline = "top";
    ctx.fillText(label, onLeft ? x - 4 * ratio : x + 4 * ratio, top + 2 * ratio);
    ctx.restore();
  };
}

function options(width, marker) {
  const axis = {
    stroke: TEXT_COLOR,
    grid: { stroke: GRID_COLOR, width: 1 },
    ticks: { stroke: GRID_COLOR, width: 1 },
  };
  return {
    width,
    height: HEIGHT,
    scales: { y: { range: [0, 100] } },
    cursor: { y: false, drag: { x: false, y: false } },
    series: [
      { label: "Time", value: hourValue },
      { label: "Rain chance", stroke: RAIN_COLOR, fill: RAIN_FILL, width: 2, points: { show: false }, value: percentValue },
      { label: "Cloud cover", stroke: CLOUD_COLOR, width: 2, points: { show: false }, value: percentValue },
    ],
    axes: [
      axis,
      {
        ...axis,
        size: 50,
        splits: () => [0, 25, 50, 75, 100],
        values: (_u, splits) => splits.map((value) => `${value}%`),
      },
    ],
    hooks: { draw: [decidedMarker(marker)] },
  };
}

export default function ForecastChart({ data, marker = null }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || data.times.length === 0) return undefined;
    const plot = new uPlot(options(el.clientWidth, marker), [data.times, data.rain, data.cloud], el);
    // Follows the card's width (phone rotation, window resizes).
    const observer = new ResizeObserver(() => {
      if (el.clientWidth > 0) plot.setSize({ width: el.clientWidth, height: HEIGHT });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      plot.destroy();
    };
  }, [data, marker]);

  return <div ref={containerRef} className="forecast-chart" />;
}
