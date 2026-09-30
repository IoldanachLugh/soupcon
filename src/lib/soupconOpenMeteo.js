// The Open-Meteo counterpart to classifySoupcon (SOUP_PLAN.md item 22): the
// same 1-5 scale and result shape, decided from WMO weather codes and
// cloud-cover numbers instead of NWS forecast text. Pure functions, no
// network or React -- fed by openMeteoApi.js's raw response.
import { describeWmoCode } from "./wmoCodes";
import { soupconResult, makeBasis } from "./soupcon";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Level 4 vs. 5: the hourly rows are split into four 12-hour blocks (the
// same ~48 hours as NWS's four 12-hour extended periods). A block is cloudy
// when its average cloud cover is at least this -- roughly where NWS starts
// saying "Mostly Cloudy" rather than "Partly Cloudy" (an estimate, not
// measured against NWS output) -- or when any hour carries a cloudy code.
export const CLOUDY_BLOCK_MIN_COVER = 70;
const BLOCK_HOURS = 12;
const BLOCK_COUNT = 4;

// Open-Meteo returns parallel arrays keyed by field name; this flattens them
// into one object per row, with times converted from unix seconds to ms and
// each code expanded through the shared WMO table. `end` is start + the
// series' step (hourly rows: 1 hour; daily: 1 day).
function rowsFrom(series, stepMs, fields) {
  return (series?.time ?? []).map((seconds, i) => {
    const code = series.weather_code?.[i];
    const { label, precipType, cloudy } = describeWmoCode(code);
    const row = { start: seconds * 1000, end: seconds * 1000 + stepMs, code, label, precipType, cloudy };
    for (const [key, field] of Object.entries(fields)) row[key] = series[field]?.[i] ?? null;
    return row;
  });
}

// Turns getOpenMeteoForecast's raw `{ current, hourly, daily }` into the
// shape the classifier and the Sources panel both read.
export function normalizeOpenMeteo(raw) {
  const current = raw?.current;
  const { label, precipType, cloudy } = describeWmoCode(current?.weather_code);
  return {
    timezone: raw?.timezone ?? null,
    current: current
      ? {
          time: current.time * 1000,
          code: current.weather_code,
          label,
          precipType,
          cloudy,
          precipitation: current.precipitation ?? null,
          rain: current.rain ?? null,
          showers: current.showers ?? null,
          snowfall: current.snowfall ?? null,
          cloudCover: current.cloud_cover ?? null,
        }
      : null,
    hourly: rowsFrom(raw?.hourly, HOUR_MS, {
      precipProbability: "precipitation_probability",
      precipitation: "precipitation",
      cloudCover: "cloud_cover",
    }),
    daily: rowsFrom(raw?.daily, DAY_MS, {
      precipProbabilityMax: "precipitation_probability_max",
      precipitation: "precipitation_sum",
    }),
  };
}

// "Is it precipitating right now": measured amounts first (snowfall wins,
// same "snow is the more specific condition" rule as textPrecipType), then
// the code. `current` is always present in a valid response, so unlike the
// NWS path there is no hourly-forecast fallback and no probability bar.
export function currentPrecipType(current) {
  if (!current) return null;
  if (current.snowfall > 0) return "snow";
  if (current.rain > 0 || current.showers > 0) return "rain";
  if (current.precipType) return current.precipType;
  return current.precipitation > 0 ? "rain" : null;
}

function rowBasis(row) {
  return makeBasis("hourly", { time: row.start, text: row.label, probability: row.precipProbability });
}

// The 12-hour blocks (up to four) the level 4 vs. 5 split is decided from,
// with why each is or isn't cloudy. Exported so the Sources panel shows
// exactly what the classifier used. `hourly` must already be limited to
// rows that haven't ended.
export function cloudBlocks(hourly) {
  const blocks = [];
  for (let block = 0; block < BLOCK_COUNT; block += 1) {
    const rows = hourly.slice(block * BLOCK_HOURS, (block + 1) * BLOCK_HOURS);
    if (rows.length === 0) break;
    const covers = rows.map((row) => row.cloudCover).filter((value) => typeof value === "number");
    const averageCover = covers.length ? covers.reduce((sum, value) => sum + value, 0) / covers.length : null;
    const hasCloudyCode = rows.some((row) => row.cloudy);
    const coverIsCloudy = averageCover !== null && averageCover >= CLOUDY_BLOCK_MIN_COVER;
    blocks.push({
      start: rows[0].start,
      end: rows[rows.length - 1].end,
      averageCover,
      hasCloudyCode,
      cloudy: hasCloudyCode || coverIsCloudy,
    });
  }
  return blocks;
}

// Rows that haven't ended yet -- shared with the Sources panel.
export function upcomingRows(rows, now = Date.now()) {
  return (rows ?? []).filter((row) => row.end > now);
}

// Same ordered checks as classifySoupcon, first match wins:
// 1 precipitating now; 2 precip in the next 12 hours; 3 in the next 48;
// 4 a cloudy block in the next 48 hours; otherwise 5. Precipitation in the
// hourly rows is decided by WMO code only (the probability is display-only).
// Rows that already ended are dropped first, so a cached response doesn't
// count past hours. `now` is injectable for tests.
export function classifyOpenMeteo({ forecast, now = Date.now() } = {}) {
  const hourly = upcomingRows(forecast?.hourly, now);

  const current = forecast?.current;
  const currentType = currentPrecipType(current);
  if (currentType) return soupconResult(1, currentType, makeBasis("current", { time: current.time, text: current.label }));

  const next12 = hourly.slice(0, 12).find((row) => row.precipType);
  if (next12) return soupconResult(2, next12.precipType, rowBasis(next12));

  const next48 = hourly.slice(0, 48).find((row) => row.precipType);
  if (next48) return soupconResult(3, next48.precipType, rowBasis(next48));

  // Precipitation in the four blocks would already have matched level 3
  // above (the blocks cover the same 48 rows), so only cloud cover is
  // checked here.
  const cloudyBlock = cloudBlocks(hourly).find((block) => block.cloudy);
  if (!cloudyBlock) return soupconResult(5);
  return soupconResult(
    4,
    null,
    makeBasis("block", {
      time: cloudyBlock.start,
      text: cloudyBlock.hasCloudyCode ? "overcast or fog hour" : `average cloud cover ${Math.round(cloudyBlock.averageCover)}%`,
    })
  );
}
