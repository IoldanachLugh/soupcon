export const CACHE_TTL_MS = 60 * 60 * 1000;
export const ZIP_CACHE_PREFIX = "soupcon_zip_lookup_";
// No longer written (SOUP_PLAN.md item 3 replaced the zone lookup with
// getLocationLabel's gridpoint cache) -- kept as an exported constant only
// because sweepExpiredCache below still lists it, not because anything
// still writes this key.
export const ZONE_CACHE_PREFIX = "soupcon_zone_lookup_";
export const ALERTS_CACHE_PREFIX = "soupcon_alerts_";
export const ALERTS_CACHE_TTL_MS = 5 * 60 * 1000;

// SOUPCON's data sources (SOUP_PLAN.md item 2).
export const GRIDPOINT_CACHE_PREFIX = "soupcon_gridpoint_";
export const HOURLY_FORECAST_CACHE_PREFIX = "soupcon_hourly_forecast_";
export const EXTENDED_FORECAST_CACHE_PREFIX = "soupcon_extended_forecast_";
export const OBSERVATION_CACHE_PREFIX = "soupcon_observation_";
// Open-Meteo, the non-US fallback (SOUP_PLAN.md item 22): one response carries
// current + hourly + daily data, so it gets a single cache entry.
export const OPEN_METEO_CACHE_PREFIX = "soupcon_openmeteo_";
// Reverse-geocoded place names for the non-US path (SOUP_PLAN.md item 22).
export const GEOCODE_CACHE_PREFIX = "soupcon_geocode_";

// Gridpoint metadata (grid office/x/y, forecast URLs, location label) is as
// stable as the zone lookup it replaces for labeling purposes -- same TTL.
export const GRIDPOINT_CACHE_TTL_MS = CACHE_TTL_MS;
// NWS regenerates the hourly forecast roughly hourly; 30 minutes keeps this
// reasonably fresh without doubling every hour's request.
export const HOURLY_FORECAST_CACHE_TTL_MS = 30 * 60 * 1000;
// The 12-hour-period extended forecast changes only a couple of times a day.
export const EXTENDED_FORECAST_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
// "Is it raining right now" needs to be genuinely current -- same order of
// magnitude as the existing alerts TTL.
export const OBSERVATION_CACHE_TTL_MS = 5 * 60 * 1000;
// Open-Meteo's `current` block updates every 15 minutes.
export const OPEN_METEO_CACHE_TTL_MS = 15 * 60 * 1000;
// A place name for a point is as stable as the NWS gridpoint label.
export const GEOCODE_CACHE_TTL_MS = CACHE_TTL_MS;

export function getCacheItem(key, ttlMs = CACHE_TTL_MS) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed?.timestamp || Date.now() - parsed.timestamp > ttlMs) {
      localStorage.removeItem(key);
      return null;
    }

    return parsed.value ?? null;
  } catch {
    return null;
  }
}

export function setCacheItem(key, value) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        timestamp: Date.now(),
        value,
      })
    );
  } catch {
    // Ignore storage failures.
  }
}

export function makeAlertsCacheKey(lat, lon) {
  return `${ALERTS_CACHE_PREFIX}${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
}

export function makeGridpointCacheKey(lat, lon) {
  return `${GRIDPOINT_CACHE_PREFIX}${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
}

export function makeHourlyForecastCacheKey(lat, lon) {
  return `${HOURLY_FORECAST_CACHE_PREFIX}${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
}

export function makeExtendedForecastCacheKey(lat, lon) {
  return `${EXTENDED_FORECAST_CACHE_PREFIX}${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
}

export function makeObservationCacheKey(lat, lon) {
  return `${OBSERVATION_CACHE_PREFIX}${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
}

export function makeOpenMeteoCacheKey(lat, lon) {
  return `${OPEN_METEO_CACHE_PREFIX}${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
}

export function makeGeocodeCacheKey(lat, lon) {
  return `${GEOCODE_CACHE_PREFIX}${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
}

// getCacheItem only evicts an expired entry when that exact key is read
// again -- a zone/alerts cache key for a location the user never revisits
// just sits in localStorage forever. Harmless individually, but with one
// key per distinct lat/lon rounding bucket, it adds up over time. Call once
// at app startup to sweep anything already expired.
const TTL_MS_BY_PREFIX = {
  [ZIP_CACHE_PREFIX]: CACHE_TTL_MS,
  [ZONE_CACHE_PREFIX]: CACHE_TTL_MS,
  [ALERTS_CACHE_PREFIX]: ALERTS_CACHE_TTL_MS,
  [GRIDPOINT_CACHE_PREFIX]: GRIDPOINT_CACHE_TTL_MS,
  [HOURLY_FORECAST_CACHE_PREFIX]: HOURLY_FORECAST_CACHE_TTL_MS,
  [EXTENDED_FORECAST_CACHE_PREFIX]: EXTENDED_FORECAST_CACHE_TTL_MS,
  [OBSERVATION_CACHE_PREFIX]: OBSERVATION_CACHE_TTL_MS,
  [OPEN_METEO_CACHE_PREFIX]: OPEN_METEO_CACHE_TTL_MS,
  [GEOCODE_CACHE_PREFIX]: GEOCODE_CACHE_TTL_MS,
};

export function sweepExpiredCache() {
  try {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      const prefix = Object.keys(TTL_MS_BY_PREFIX).find((p) => key.startsWith(p));
      if (prefix) {
        // Reuses getCacheItem's own expiry check and eviction rather than
        // duplicating it -- the return value doesn't matter here, only
        // the side effect of removing the key when it's expired.
        getCacheItem(key, TTL_MS_BY_PREFIX[prefix]);
      }
    }
  } catch {
    // Ignore storage failures (see safeGetItem/safeSetItem above for why
    // this can throw) -- worst case, the sweep just doesn't happen.
  }
}

// For the handful of plain (non-TTL) localStorage reads/writes elsewhere in
// the app -- e.g. remembering the last-used ZIP/lookup method -- that don't
// go through getCacheItem/setCacheItem above. Touching localStorage at all
// can throw (Safari with all cookies/site data blocked, some hardened
// privacy extensions, certain embedded webviews), so every direct call site
// needs the same try/catch treatment the TTL cache already has.
export function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
