import {
  getCacheItem,
  setCacheItem,
  makeAlertsCacheKey,
  makeGridpointCacheKey,
  makeHourlyForecastCacheKey,
  makeExtendedForecastCacheKey,
  makeObservationCacheKey,
  ZIP_CACHE_PREFIX,
  ALERTS_CACHE_TTL_MS,
  GRIDPOINT_CACHE_TTL_MS,
  HOURLY_FORECAST_CACHE_TTL_MS,
  EXTENDED_FORECAST_CACHE_TTL_MS,
  OBSERVATION_CACHE_TTL_MS,
} from "./cache";

export const WEATHER_GOV_BASE = "https://api.weather.gov";
export const ZIP_API_BASE = "https://api.zippopotam.us/us";
export const FETCH_TIMEOUT_MS = 10000;
export const ALERTS_AUTO_REFRESH_MS = 5 * 60 * 1000;

// Mobile browsers throttle or freeze setInterval timers for background tabs
// and suspended/installed PWAs, so ALERTS_AUTO_REFRESH_MS alone can't be
// trusted to catch up promptly when the app is reopened from the
// background -- how quickly (if at all) a frozen interval fires again
// varies by browser. So the app also refreshes on visibilitychange, but
// only if the data on screen is already at least this stale -- otherwise
// switching tabs for a couple seconds would trigger a needless refetch.
export const STALE_ON_VISIBLE_MS = 60 * 1000;

// Note: api.weather.gov asks consumers to identify themselves via a
// User-Agent header, but that's only practical from server-side code.
// Browsers won't let a page set a real custom User-Agent: Chrome/Firefox
// silently ignore the value, while Safari (all iOS browsers, since they're
// required to use WebKit) actually sends it as a genuine custom header --
// which then requires api.weather.gov's CORS preflight to explicitly allow
// "User-Agent" in Access-Control-Allow-Headers, which it doesn't. The result
// is every request failing specifically on iOS/Safari with a CORS error.
// So this header is intentionally left off client-side fetches below.

export function isValidZip(zip) {
  return /^\d{5}$/.test(zip.trim());
}

// Carries the technical detail (status code, URL, whether it was a timeout)
// separately from the message shown to the user -- fetchJson itself has no
// idea what a failure should say to a person, since that depends on which
// lookup was in flight (a 404 means something different for a ZIP lookup
// than for a coordinate lookup). See friendlyMessage() below, which is
// where that detail gets translated, one call site at a time.
export class HttpError extends Error {
  constructor(message, { status, url, timeout = false } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.timeout = timeout;
  }
}

export async function fetchJson(url, { signal } = {}) {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), FETCH_TIMEOUT_MS);

  // Combine an external abort signal (e.g. a stale request being superseded)
  // with our own timeout, so either can cancel the request.
  const onExternalAbort = () => timeoutController.abort();
  if (signal) {
    if (signal.aborted) timeoutController.abort();
    else signal.addEventListener("abort", onExternalAbort);
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/geo+json, application/json",
      },
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      throw new HttpError(`Request failed (${response.status}) for ${url}`, { status: response.status, url });
    }

    return await response.json();
  } catch (err) {
    if (timeoutController.signal.aborted && !(signal && signal.aborted)) {
      throw new HttpError(`Request timed out for ${url}`, { url, timeout: true });
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener("abort", onExternalAbort);
  }
}

// Thrown by the NWS gridpoint lookup when `/points` answers 404 for a
// coordinate: NWS covers US points only and returns 404 (problem type
// `InvalidPoint`, "Data Unavailable For Requested Point") for anywhere else,
// London and Vancouver included (checked live; Puerto Rico, Hawaii, Alaska
// and Guam all resolve). weatherProvider.js falls back to Open-Meteo on
// exactly this error and nothing else -- an NWS outage (5xx, timeout) must
// still surface as a failure, not silently switch provider. The message is
// the same one a 404 always showed.
export const OUTSIDE_NWS_COVERAGE_MESSAGE = "This location isn't covered by the National Weather Service.";

export class OutsideNwsCoverageError extends Error {
  constructor() {
    super(OUTSIDE_NWS_COVERAGE_MESSAGE);
    this.name = "OutsideNwsCoverageError";
  }
}

// Turns a raw HttpError into copy a person can actually act on -- never a
// URL, a status code, or the word "fetch". The technical detail isn't
// thrown away, just moved: it still goes to the console for whoever's
// debugging, it's just not what ends up in the app's error box.
// `notFoundMessage` is optional -- only some call sites have something
// specific to say about a 404; everything else (5xx, other 4xx, timeouts)
// falls back to the same generic "try again" message regardless of source.
// Returns null for anything that isn't an HttpError, so the caller knows to
// fall back to its own handling instead.
export function friendlyMessage(err, notFoundMessage) {
  if (!(err instanceof HttpError)) return null;

  console.error(err.timeout ? `Request timed out for ${err.url}` : `Request failed (${err.status}) for ${err.url}`);

  if (err.status === 404 && notFoundMessage) {
    return notFoundMessage;
  }
  return "The weather service isn't responding right now. Try again in a minute.";
}

export async function getLatLonFromZip(zip, { signal } = {}) {
  const cached = getCacheItem(`${ZIP_CACHE_PREFIX}${zip}`);
  if (cached) {
    return cached;
  }

  let data;
  try {
    data = await fetchJson(`${ZIP_API_BASE}/${zip}`, { signal });
  } catch (err) {
    const message = friendlyMessage(err, "We couldn't find that ZIP code.");
    throw message ? new Error(message) : err;
  }
  const place = data?.places?.[0];

  if (!place) {
    // Same "not found" case as the 404 above, just discovered a different
    // way -- zippopotam.us returns 200 with an empty places array for some
    // malformed-but-numeric inputs instead of 404ing. Same user-facing
    // message either way.
    throw new Error("We couldn't find that ZIP code.");
  }

  const value = {
    lat: Number(place.latitude),
    lon: Number(place.longitude),
  };

  setCacheItem(`${ZIP_CACHE_PREFIX}${zip}`, value);
  return value;
}

export async function getActiveAlertsByPoint(lat, lon, { signal, skipCache = false } = {}) {
  // Deliberately NOT /alerts/active/zone/{forecastZoneId}: that endpoint
  // only returns alerts coded to the forecast zone (UGC "xxZnnn"). Some
  // winter alert types -- Snow Squall Warning among them -- are issued by
  // county or storm polygon (UGC "xxCnnn") instead, and a zone-only query
  // silently misses those entirely. /alerts/active?point= matches on the
  // actual alert geometry/UGC coverage regardless of which kind it is, so
  // it catches both. Confirmed live: zone-coded county/polygon alerts
  // (Flash Flood Warning, Flood Advisory, Flood Warning) were absent from
  // the zone endpoint but present via ?point= for the same coordinates.
  const cacheKey = makeAlertsCacheKey(lat, lon);

  if (!skipCache) {
    const cached = getCacheItem(cacheKey, ALERTS_CACHE_TTL_MS);
    if (cached) {
      return cached;
    }
  }

  let data;
  try {
    data = await fetchJson(`${WEATHER_GOV_BASE}/alerts/active?point=${lat},${lon}&status=actual`, { signal });
  } catch (err) {
    const message = friendlyMessage(err);
    throw message ? new Error(message) : err;
  }
  const value = data?.features || [];

  setCacheItem(cacheKey, value);
  return value;
}

// Shared by getLocationLabel/getHourlyForecast/getExtendedForecast/
// getCurrentConditions below -- all four need the same /points response (it
// carries the grid office/x/y used to build both forecast URLs, the
// observation stations URL, and the location label), so this fetches and
// caches it once instead of each hitting /points separately for the same
// location. App.jsx's runLookupFromCoordinates calls all four in parallel
// via Promise.all with a shared AbortSignal, so on a cold cache they'd
// otherwise all race to fetch the exact same /points URL at once --
// gridpointRequestsInFlight collapses that into a single request, with
// later callers awaiting the first one's in-flight promise instead of
// starting their own. The shared request runs on its *first* caller's
// signal, so an entry whose signal has been aborted is never joined: a new
// lookup for the same location started right after cancelling the old one
// would otherwise inherit that cancellation and surface a raw "aborted"
// error. It starts its own request instead (replacing the dead entry).
const gridpointRequestsInFlight = new Map();

async function getGridpointInfo(lat, lon, { signal } = {}) {
  const cacheKey = makeGridpointCacheKey(lat, lon);
  const cached = getCacheItem(cacheKey, GRIDPOINT_CACHE_TTL_MS);
  if (cached) {
    return cached;
  }

  const inFlight = gridpointRequestsInFlight.get(cacheKey);
  if (inFlight && !inFlight.signal?.aborted) {
    return inFlight.promise;
  }

  const requestPromise = (async () => {
    let pointData;
    try {
      pointData = await fetchJson(`${WEATHER_GOV_BASE}/points/${lat},${lon}`, { signal });
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) throw new OutsideNwsCoverageError();
      const message = friendlyMessage(err);
      throw message ? new Error(message) : err;
    }

    const p = pointData?.properties ?? {};
    if (!p.forecastHourly || !p.forecast) {
      throw new Error("Could not determine the NWS forecast grid for this location.");
    }

    const relLoc = p.relativeLocation?.properties;

    const value = {
      forecastHourlyUrl: p.forecastHourly,
      forecastUrl: p.forecast,
      observationStationsUrl: p.observationStations || null,
      // City/state read better in a rain-forecast app than a forecast zone
      // name (e.g. "Seattle, WA" vs. "King County") -- SOUPCON uses this
      // instead of the FRTCON-era getZoneByPoint name.
      locationLabel: relLoc?.city && relLoc?.state ? `${relLoc.city}, ${relLoc.state}` : null,
    };

    setCacheItem(cacheKey, value);
    return value;
  })();

  const entry = { promise: requestPromise, signal };
  gridpointRequestsInFlight.set(cacheKey, entry);
  try {
    return await requestPromise;
  } finally {
    // Only remove our own entry -- an aborted one may already have been
    // replaced by a newer request for the same location (see above).
    if (gridpointRequestsInFlight.get(cacheKey) === entry) {
      gridpointRequestsInFlight.delete(cacheKey);
    }
  }
}

export async function getLocationLabel(lat, lon, { signal } = {}) {
  const gridpoint = await getGridpointInfo(lat, lon, { signal });
  return gridpoint.locationLabel || "this location";
}

export async function getHourlyForecast(lat, lon, { signal, skipCache = false } = {}) {
  const cacheKey = makeHourlyForecastCacheKey(lat, lon);
  if (!skipCache) {
    const cached = getCacheItem(cacheKey, HOURLY_FORECAST_CACHE_TTL_MS);
    if (cached) {
      return cached;
    }
  }

  const gridpoint = await getGridpointInfo(lat, lon, { signal });

  let data;
  try {
    data = await fetchJson(gridpoint.forecastHourlyUrl, { signal });
  } catch (err) {
    const message = friendlyMessage(err);
    throw message ? new Error(message) : err;
  }

  // The hourly forecast is what levels 1-3 are decided from -- with no
  // periods at all, classifySoupcon would match nothing and fall through
  // to level 5, "Clear and sunny" (the same silent-fallthrough trap as
  // CONTEXT.md's snow gotcha). Treat it as a failed lookup instead, and
  // don't cache it. A background refresh hitting this just keeps the last
  // good data, same as any other refresh failure.
  const value = data?.properties?.periods || [];
  if (value.length === 0) {
    console.error(`No hourly forecast periods returned for ${gridpoint.forecastHourlyUrl}`);
    throw new Error("The weather service didn't return a forecast for this location. Try again in a minute.");
  }
  setCacheItem(cacheKey, value);
  return value;
}

export async function getExtendedForecast(lat, lon, { signal, skipCache = false } = {}) {
  const cacheKey = makeExtendedForecastCacheKey(lat, lon);
  if (!skipCache) {
    const cached = getCacheItem(cacheKey, EXTENDED_FORECAST_CACHE_TTL_MS);
    if (cached) {
      return cached;
    }
  }

  const gridpoint = await getGridpointInfo(lat, lon, { signal });

  let data;
  try {
    data = await fetchJson(gridpoint.forecastUrl, { signal });
  } catch (err) {
    const message = friendlyMessage(err);
    throw message ? new Error(message) : err;
  }

  const value = data?.properties?.periods || [];
  setCacheItem(cacheKey, value);
  return value;
}

// A station can be listed as "the" observation station for a point and
// still not have reported in hours (or ever) -- NWS doesn't guarantee
// freshness. Rather than trust station #1 blindly (SOUP_PLAN.md's
// nearest-station-staleness open question), this tries a few of the
// nearest stations and takes the nearest one with a reading recent enough
// to trust for "is it raining right now."
//
// Which stations count as "nearby" (SOUP_PLAN.md item 17, per owner):
// everything within OBSERVATION_STATION_RADIUS_MILES, but always at least
// MIN_OBSERVATION_STATIONS_TO_TRY (the nearest ones, however far -- rural
// points can have only one station within 60 miles, e.g. Ely, NV), and
// never more than MAX_OBSERVATION_STATIONS_TO_TRY, since they're all
// fetched at once and dense areas have dozens in range (41 around Seattle
// when checked live).
const OBSERVATION_STATION_RADIUS_MILES = 60;
const MIN_OBSERVATION_STATIONS_TO_TRY = 2;
const MAX_OBSERVATION_STATIONS_TO_TRY = 5;
const OBSERVATION_MAX_AGE_MS = 90 * 60 * 1000;

const EARTH_RADIUS_MILES = 3958.8;

export function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a));
}

// Sorts by computed distance rather than trusting NWS's list order, which
// is only roughly by proximity (confirmed live: not strictly sorted for
// Seattle, Minneapolis, or Chicago). A station with no usable coordinates
// sorts last (Array.prototype.sort is stable, so NWS's order is kept among
// those) -- it can still be picked to reach the minimum, but never counts
// as within the radius.
export function selectObservationStationsWithDistance(features, lat, lon) {
  const byDistance = (features || [])
    .filter((feature) => feature?.id)
    .map((feature) => {
      const [stationLon, stationLat] = feature.geometry?.coordinates ?? [];
      const miles =
        typeof stationLat === "number" && typeof stationLon === "number"
          ? haversineMiles(lat, lon, stationLat, stationLon)
          : Infinity;
      return { url: feature.id, miles };
    })
    .sort((a, b) => a.miles - b.miles);

  const withinRadius = byDistance.filter((station) => station.miles <= OBSERVATION_STATION_RADIUS_MILES).length;
  const count = Math.min(MAX_OBSERVATION_STATIONS_TO_TRY, Math.max(MIN_OBSERVATION_STATIONS_TO_TRY, withinRadius));
  return byDistance.slice(0, count);
}

export function selectObservationStations(features, lat, lon) {
  return selectObservationStationsWithDistance(features, lat, lon).map((station) => station.url);
}

// Fresh isn't enough on its own: plenty of stations (including some major
// airports, e.g. KMDW when checked live) post timely observations with an
// empty textDescription and no precipitationLastHour at all. Accepting one
// of those would read as "definitely not raining" (and, being non-null,
// would also suppress classifySoupcon's hourly-forecast fallback), when
// it actually says nothing about precipitation either way -- so skip it
// and try the next station instead.
function observationHasWeather(props) {
  return Boolean(props.textDescription?.trim()) || typeof props.precipitationLastHour?.value === "number";
}

function isUsableObservation(props) {
  const timestamp = props?.timestamp ? new Date(props.timestamp).getTime() : NaN;
  return (
    Boolean(props) &&
    !Number.isNaN(timestamp) &&
    Date.now() - timestamp <= OBSERVATION_MAX_AGE_MS &&
    observationHasWeather(props)
  );
}

// All candidate stations are fetched in parallel, not one at a time:
// getCurrentConditions sits inside App.jsx's lookup Promise.all, so a
// sequential walk (each fetch with its own FETCH_TIMEOUT_MS) could hold the
// whole lookup on "Looking up..." for ~a minute when NWS is slow. In
// parallel the worst case is one timeout. Nearest-first preference is
// kept by picking from the results in station order, not arrival order.
async function findFreshObservation(stationUrls, { signal } = {}) {
  const observations = await Promise.all(
    stationUrls.map((stationUrl) =>
      fetchJson(`${stationUrl}/observations/latest`, { signal })
        .then((obsData) => obsData?.properties ?? null)
        // This station has no recent observation at all (common -- not
        // every listed station reports reliably); a single station's gap
        // shouldn't fail the whole lookup.
        .catch(() => null)
    )
  );
  return observations.find(isUsableObservation) ?? null;
}

// Returns null (not a throw) when no fresh-enough observation could be
// found -- this is a "nice to have" data source for level 1 specifically;
// classifySoupcon already knows how to fall back to the current hourly
// forecast period when observation is null, so a gap here shouldn't fail
// the whole lookup the way a failed hourly/extended forecast fetch would.
export async function getCurrentConditions(lat, lon, { signal, skipCache = false } = {}) {
  const cacheKey = makeObservationCacheKey(lat, lon);
  if (!skipCache) {
    const cached = getCacheItem(cacheKey, OBSERVATION_CACHE_TTL_MS);
    if (cached) {
      return cached;
    }
  }

  const gridpoint = await getGridpointInfo(lat, lon, { signal });
  if (!gridpoint.observationStationsUrl) {
    return null;
  }

  let stationsData;
  try {
    stationsData = await fetchJson(gridpoint.observationStationsUrl, { signal });
  } catch (err) {
    console.error(err.message);
    return null;
  }

  const stationUrls = selectObservationStations(stationsData?.features, lat, lon);
  const value = await findFreshObservation(stationUrls, { signal });

  // Deliberately not caching a null result: getCacheItem can't distinguish
  // a cached `null` from a cache miss (see cache.js), so caching it here
  // would buy nothing over just letting the next call re-check -- and a
  // station that had no fresh reading a few minutes ago may well have one
  // now.
  if (value) {
    setCacheItem(cacheKey, value);
  }
  return value;
}

// Used only by the "Sources" panel (fetched while it is open): every candidate
// station's latest reading in nearest-first order -- the same stations and
// the same usability rules getCurrentConditions applies -- so it's visible
// which one is actually driving "currently raining" and why the nearer ones
// were skipped. Never cached and never part of a normal lookup; costs one
// request per candidate station. `chosen` marks the reading
// findFreshObservation would pick (the nearest usable one).
export async function getStationReadings(lat, lon, { signal } = {}) {
  const gridpoint = await getGridpointInfo(lat, lon, { signal });
  if (!gridpoint.observationStationsUrl) return [];

  const stationsData = await fetchJson(gridpoint.observationStationsUrl, { signal });
  const stations = selectObservationStationsWithDistance(stationsData?.features, lat, lon);

  const readings = await Promise.all(
    stations.map(async ({ url, miles }) => {
      const stationId = url.split("/").pop();
      try {
        const data = await fetchJson(`${url}/observations/latest`, { signal });
        const props = data?.properties ?? null;
        return {
          stationId,
          miles,
          timestamp: props?.timestamp ?? null,
          textDescription: props?.textDescription ?? "",
          precipitationLastHour: props?.precipitationLastHour?.value ?? null,
          usable: isUsableObservation(props),
          error: null,
        };
      } catch (err) {
        if (signal?.aborted) throw err;
        return { stationId, miles, timestamp: null, textDescription: "", precipitationLastHour: null, usable: false, error: "no observation" };
      }
    })
  );

  const chosenIndex = readings.findIndex((reading) => reading.usable);
  return readings.map((reading, index) => ({ ...reading, chosen: index === chosenIndex }));
}
