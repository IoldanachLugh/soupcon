// Data for the Sources panel's 48-hour chart (SOUP_PLAN.md item 27): rain
// chance and cloud cover per hour, in uPlot's column format. Pure functions,
// no uPlot/DOM dependency, so they're unit-testable like the classifiers.
//
// Same 48-hour window and ended-period filtering as the classifiers, so the
// chart covers exactly the hours levels 2-3 are decided from.
export const CHART_HOURS = 48;

const HOUR_MS = 60 * 60 * 1000;

function hourKey(ms) {
  return Math.floor(ms / HOUR_MS);
}

function number(value) {
  return typeof value === "number" ? value : null;
}

// uPlot wants x values in seconds and one array per series, with null for a
// missing point (drawn as a gap rather than a drop to zero).
function columns(rows) {
  return {
    times: rows.map((row) => row.start / 1000),
    rain: rows.map((row) => row.rain),
    cloud: rows.map((row) => row.cloud),
  };
}

// NWS: rain chance from the hourly periods themselves, cloud cover from the
// raw gridpoint skyCover (getSkyCover's { start, value } hours), matched by
// hour. `skyCover` may be null (not loaded yet, or the fetch failed): the
// cloud series is then all null and the chart shows rain only.
export function nwsChartData(hourlyPeriods, skyCover, now = Date.now()) {
  const cloudByHour = new Map((skyCover ?? []).map((hour) => [hourKey(hour.start), hour.value]));
  const rows = (hourlyPeriods ?? [])
    .map((period) => ({ period, start: Date.parse(period?.startTime), end: Date.parse(period?.endTime) }))
    .filter(({ start, end }) => !Number.isNaN(start) && (Number.isNaN(end) || end > now))
    .slice(0, CHART_HOURS)
    .map(({ period, start }) => ({
      start,
      rain: number(period.probabilityOfPrecipitation?.value),
      cloud: number(cloudByHour.get(hourKey(start))),
    }));
  return columns(rows);
}

// Open-Meteo: both numbers are already on each normalized hourly row (see
// normalizeOpenMeteo). `hourly` must already be limited to rows that haven't
// ended (upcomingRows).
export function openMeteoChartData(hourly) {
  return columns(
    (hourly ?? []).slice(0, CHART_HOURS).map((row) => ({
      start: row.start,
      rain: number(row.precipProbability),
      cloud: number(row.cloudCover),
    }))
  );
}

// The hour the "Decided by" line names, in seconds for the chart's x axis --
// only when that was an hourly row (levels 1-3); other bases (a station
// reading, an extended period, a cloud block) aren't a single chart hour.
export function decidedHour(soupcon) {
  const basis = soupcon?.basis;
  if (basis?.source !== "hourly" || basis.time == null) return null;
  const ms = typeof basis.time === "number" ? basis.time : Date.parse(basis.time);
  return Number.isNaN(ms) ? null : ms / 1000;
}
