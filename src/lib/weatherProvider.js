import {
  OutsideNwsCoverageError,
  getLocationLabel,
  getHourlyForecast,
  getExtendedForecast,
  getCurrentConditions,
  getActiveAlertsByPoint,
} from "./weatherApi";
import { getOpenMeteoForecast } from "./openMeteoApi";
import { getReverseGeocodedLabel, coordinatesLabel } from "./reverseGeocode";
import { classifySoupcon } from "./soupcon";
import { normalizeOpenMeteo, classifyOpenMeteo } from "./soupconOpenMeteo";

// Picks the weather data source for a lookup (SOUP_PLAN.md item 22): NWS for
// US points, Open-Meteo for everywhere else. NWS is tried first, and Open-
// Meteo is used only when NWS says the point is outside its coverage (see
// OutsideNwsCoverageError) -- not a bounding box, which would misjudge
// borders and the US territories.
//
// Every lookup returns the same outer shape, tagged with `provider`:
//   { provider: "nws", locationLabel, hourlyPeriods, extendedPeriods, observation, alerts }
//   { provider: "open-meteo", locationLabel, openMeteo, alerts: [] }
// (an Open-Meteo result has no NWS alerts, and none of the NWS fields).
export const PROVIDER_NWS = "nws";
export const PROVIDER_OPEN_METEO = "open-meteo";

// How long a lookup waits for the reverse geocoder before showing
// coordinates instead -- the label is cosmetic and must not hold up the
// forecast. The geocoder request keeps going and caches its answer, so the
// next lookup of the same place gets the name.
export const GEOCODE_WAIT_MS = 3000;

function withTimeout(promise, ms) {
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

// The place name for an Open-Meteo lookup. The reverse geocoder's Fair Use
// Policy only allows the device's own location (see reverseGeocode.js), so
// it is asked only for a browser-geolocation lookup -- never for `?lat=&lon=`
// URL coordinates, which show the coordinates themselves.
async function openMeteoLabel(lat, lon, { signal, source, geocodeWaitMs }) {
  if (source === "browser") {
    const name = await withTimeout(getReverseGeocodedLabel(lat, lon, { signal }), geocodeWaitMs);
    if (name) return name;
  }
  return coordinatesLabel(lat, lon);
}

async function lookupOpenMeteo(lat, lon, { signal, skipCache, source, geocodeWaitMs }) {
  const [raw, locationLabel] = await Promise.all([
    getOpenMeteoForecast(lat, lon, { signal, skipCache }),
    openMeteoLabel(lat, lon, { signal, source, geocodeWaitMs }),
  ]);
  return { provider: PROVIDER_OPEN_METEO, locationLabel, openMeteo: normalizeOpenMeteo(raw), alerts: [] };
}

// `source` is how the coordinates were obtained ("browser", "zip" or "url");
// it only matters for the Open-Meteo place name.
export async function lookupWeather(
  lat,
  lon,
  { signal, skipCache = false, source, geocodeWaitMs = GEOCODE_WAIT_MS } = {}
) {
  // Started now so it still runs alongside the NWS requests, but its failure
  // is ignored here: a point outside NWS coverage makes this 4xx too, which
  // must not beat the coverage error below. When NWS does cover the point, it
  // is awaited (and its failure counts) in the Promise.all further down.
  const alertsPromise = getActiveAlertsByPoint(lat, lon, { signal, skipCache });
  alertsPromise.catch(() => {});

  let locationLabel;
  try {
    // The first NWS call: it resolves the gridpoint the other three share
    // (a single cached /points request -- see getGridpointInfo), so it is
    // also where "not a US point" shows up.
    locationLabel = await getLocationLabel(lat, lon, { signal });
  } catch (err) {
    if (err instanceof OutsideNwsCoverageError) {
      return lookupOpenMeteo(lat, lon, { signal, skipCache, source, geocodeWaitMs });
    }
    throw err;
  }

  const [hourlyPeriods, extendedPeriods, observation, alerts] = await Promise.all([
    getHourlyForecast(lat, lon, { signal }),
    getExtendedForecast(lat, lon, { signal }),
    getCurrentConditions(lat, lon, { signal }),
    alertsPromise,
  ]);
  return { provider: PROVIDER_NWS, locationLabel, hourlyPeriods, extendedPeriods, observation, alerts };
}

// Background refresh of a lookup already on screen: returns only the fields
// that change (merge into the existing result), from the same provider the
// lookup used -- NWS is not re-probed. Bypasses every cache, like the
// refresh always has.
export async function refreshWeather(lat, lon, provider) {
  if (provider === PROVIDER_OPEN_METEO) {
    const raw = await getOpenMeteoForecast(lat, lon, { skipCache: true });
    return { openMeteo: normalizeOpenMeteo(raw) };
  }
  const [hourlyPeriods, extendedPeriods, observation, alerts] = await Promise.all([
    getHourlyForecast(lat, lon, { skipCache: true }),
    getExtendedForecast(lat, lon, { skipCache: true }),
    getCurrentConditions(lat, lon, { skipCache: true }),
    getActiveAlertsByPoint(lat, lon, { skipCache: true }),
  ]);
  return { hourlyPeriods, extendedPeriods, observation, alerts };
}

// The SOUPCON result for a lookup result, from whichever classifier matches
// its provider.
export function classifyLookup(result) {
  if (!result) return null;
  if (result.provider === PROVIDER_OPEN_METEO) return classifyOpenMeteo({ forecast: result.openMeteo });
  return classifySoupcon({
    hourlyPeriods: result.hourlyPeriods,
    observation: result.observation,
    extendedPeriods: result.extendedPeriods,
  });
}
