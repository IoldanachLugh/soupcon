import { getCacheItem, setCacheItem, makeOpenMeteoCacheKey, OPEN_METEO_CACHE_TTL_MS } from "./cache";
import { fetchJson, friendlyMessage } from "./weatherApi";

// Open-Meteo is the non-US fallback data source (SOUP_PLAN.md item 22).
// Free, no API key, CORS open (checked live). This module only fetches and
// caches the raw response; turning it into the periods/observation shapes
// classifySoupcon takes is a separate step (item 22, step 3).
export const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";

// Times come back as unix seconds (`timeformat=unixtime`), each the *start*
// of its period as a true instant -- without it, `timezone=auto` gives local
// strings with no offset, which are easy to misread. `timezone=auto` makes
// the daily rows line up with the location's own days (checked live for
// Tokyo: daily rows start at local midnight; with `timezone=UTC` they would
// be UTC days). `forecast_hours=48&past_hours=0` makes the hourly series
// start at the current hour; by default it starts at local midnight today
// and includes hours that already ended.
const CURRENT_FIELDS = "weather_code,precipitation,rain,showers,snowfall,cloud_cover";
const HOURLY_FIELDS = "weather_code,precipitation_probability,precipitation,cloud_cover";
const DAILY_FIELDS = "weather_code,precipitation_probability_max,precipitation_sum";

export function makeOpenMeteoUrl(lat, lon) {
  return (
    `${OPEN_METEO_BASE}?latitude=${lat}&longitude=${lon}` +
    `&current=${CURRENT_FIELDS}&hourly=${HOURLY_FIELDS}&daily=${DAILY_FIELDS}` +
    `&forecast_hours=48&past_hours=0&forecast_days=7&timeformat=unixtime&timezone=auto`
  );
}

// Returns `{ current, hourly, daily, timezone }` exactly as Open-Meteo shapes them
// (`hourly`/`daily` are parallel arrays keyed by field name, with `time`).
export async function getOpenMeteoForecast(lat, lon, { signal, skipCache = false } = {}) {
  const cacheKey = makeOpenMeteoCacheKey(lat, lon);
  if (!skipCache) {
    const cached = getCacheItem(cacheKey, OPEN_METEO_CACHE_TTL_MS);
    if (cached) {
      return cached;
    }
  }

  let data;
  try {
    data = await fetchJson(makeOpenMeteoUrl(lat, lon), { signal });
  } catch (err) {
    const message = friendlyMessage(err);
    throw message ? new Error(message) : err;
  }

  // Same trap as an empty NWS hourly forecast: with no hourly rows the
  // classifier would fall through to level 5, "Clear and sunny." Fail the
  // lookup instead and don't cache it.
  if (!data?.hourly?.time?.length || !data?.daily?.time?.length || !data?.current) {
    console.error(`Incomplete Open-Meteo response for ${lat},${lon}`);
    throw new Error("The weather service didn't return a forecast for this location. Try again in a minute.");
  }

  // `timezone` is the location's IANA zone ("Asia/Tokyo"), for labeling days.
  const value = { current: data.current, hourly: data.hourly, daily: data.daily, timezone: data.timezone ?? null };
  setCacheItem(cacheKey, value);
  return value;
}
