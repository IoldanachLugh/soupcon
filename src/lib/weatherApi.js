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

// Turns a raw HttpError into copy a person can actually act on -- never a
// URL, a status code, or the word "fetch". The technical detail isn't
// thrown away, just moved: it still goes to the console for whoever's
// debugging, it's just not what ends up in the app's error box.
// `notFoundMessage` is optional -- only some call sites have something
// specific to say about a 404; everything else (5xx, other 4xx, timeouts)
// falls back to the same generic "try again" message regardless of source.
// Returns null for anything that isn't an HttpError, so the caller knows to
// fall back to its own handling instead.
function friendlyMessage(err, notFoundMessage) {
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
// starting their own. (Relies on this app's actual call pattern always
// passing the same signal to concurrent calls for the same location --
// not a general-purpose per-caller-cancellation guarantee.)
const gridpointRequestsInFlight = new Map();

async function getGridpointInfo(lat, lon, { signal } = {}) {
  const cacheKey = makeGridpointCacheKey(lat, lon);
  const cached = getCacheItem(cacheKey, GRIDPOINT_CACHE_TTL_MS);
  if (cached) {
    return cached;
  }

  const inFlight = gridpointRequestsInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const requestPromise = (async () => {
    let pointData;
    try {
      pointData = await fetchJson(`${WEATHER_GOV_BASE}/points/${lat},${lon}`, { signal });
    } catch (err) {
      const message = friendlyMessage(err, "This location isn't covered by the National Weather Service.");
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

  gridpointRequestsInFlight.set(cacheKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    gridpointRequestsInFlight.delete(cacheKey);
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

  const value = data?.properties?.periods || [];
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
// freshness, just proximity order. Rather than trust station #1 blindly
// (SOUP_PLAN.md's nearest-station-staleness open question), this tries a
// few of the nearest stations in order and takes the first one with a
// reading recent enough to trust for "is it raining right now."
const MAX_OBSERVATION_STATIONS_TO_TRY = 5;
const OBSERVATION_MAX_AGE_MS = 90 * 60 * 1000;

async function findFreshObservation(stationUrls, { signal } = {}) {
  for (const stationUrl of stationUrls.slice(0, MAX_OBSERVATION_STATIONS_TO_TRY)) {
    let obsData;
    try {
      obsData = await fetchJson(`${stationUrl}/observations/latest`, { signal });
    } catch {
      // This station has no recent observation at all (common -- not every
      // listed station reports reliably); try the next one rather than
      // failing the whole lookup over a single station's gap.
      continue;
    }

    const props = obsData?.properties;
    const timestamp = props?.timestamp ? new Date(props.timestamp).getTime() : NaN;
    if (props && !Number.isNaN(timestamp) && Date.now() - timestamp <= OBSERVATION_MAX_AGE_MS) {
      return props;
    }
  }
  return null;
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

  const stationUrls = (stationsData?.features || []).map((feature) => feature?.id).filter(Boolean);
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
